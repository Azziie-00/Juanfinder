const normalize = value => String(value || '').trim().toLowerCase();
const clip = (value, length) => String(value || '').trim().slice(0, length);
const genericWords = new Set(('the and for with from that this their your have has using uses used use build building develop developing development design designing project capstone research study students student adviser expertise experience skills skilled specialization specialized specialist specializes system systems application applications platform based practical technical technology technologies work group title description proposed propose needs need support knowledge solutions solution tools tool including related relevant improve improving create creating service services management').split(' '));
function topics(value) {
    const text = normalize(value)
        .replace(/\bartificial intelligence\b|\bmachine learning\b|\bdeep learning\b/g, ' ai ')
        .replace(/\binternet of things\b/g, ' iot ')
        .replace(/\bdatabases\b|\bsql\b/g, ' database ')
        .replace(/\bembedded\b|\bmicrocontrollers?\b/g, ' embedded ')
        .replace(/\baccountancy\b/g, ' accounting ')
        .replace(/\btaxation\b|\btaxes\b/g, ' tax ');
    return new Set((text.match(/[\p{L}\p{N}+#]+/gu) || [])
        .filter(word => (word.length >= 3 || word === 'ai') && !genericWords.has(word)));
}

function shortlistAdvisers(context, candidates) {
    const projectTopics = topics(Object.values(context).join(' '));
    // 1B can force weak recommendations to fill a list. Require a concrete
    // topic overlap before inference; common project boilerplate is not evidence.
    return candidates.map(adviser => ({ adviser,
        overlap: [...topics(adviser.expertise)].filter(topic => projectTopics.has(topic)).length }))
        .filter(item => item.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap || Number(a.adviser.user_id) - Number(b.adviser.user_id))
        .slice(0, 12).map(item => item.adviser);
}

function eligibleAdvisers(group, advisers, now = Date.now()) {
    const course = normalize(group.course);
    return advisers.filter(adviser => course && course !== 'unspecified'
        && normalize(adviser.course) === course && adviser.is_active
        && (!adviser.expires_at || Date.parse(adviser.expires_at) > now)
        && Number(adviser.remaining_slots) > 0 && clip(adviser.expertise, 1000));
}

function cleanAdviserRecommendations(payload, candidates) {
    if (!Array.isArray(payload?.recommendations)) throw new Error('Invalid adviser response.');
    const byId = new Map(candidates.map(item => [Number(item.user_id), item]));
    const seen = new Set();
    return payload.recommendations.flatMap(item => {
        const adviser = byId.get(item?.adviser_id);
        if (!adviser || seen.has(item.adviser_id) || typeof item.reason !== 'string' || !item.reason.trim()
            || typeof item.evidence !== 'string' || !item.evidence.trim()
            || item.evidence.length > 240 || !normalize(adviser.expertise).includes(normalize(item.evidence))) return [];
        seen.add(item.adviser_id);
        return [{ adviser: { id: String(adviser.user_id), name: adviser.name, bio: adviser.bio || '',
            course: adviser.course, remainingSlots: Number(adviser.remaining_slots) },
        reason: item.reason.trim().slice(0, 600), evidence: item.evidence.trim() }];
    }).slice(0, 3);
}

function createAdviserRecommendationHandler({ supabase, callAIService }) {
    const inFlight = new Set();
    async function readAll(table, columns, filter = query => query, order = 'user_id') {
        const rows = [];
        for (let offset = 0; ; offset += 1000) {
            const result = await filter(supabase.from(table).select(columns)).order(order).range(offset, offset + 999);
            if (result.error) throw new Error('Unable to read adviser eligibility.');
            rows.push(...result.data);
            if (result.data.length < 1000) return rows;
        }
    }
    async function load(userId) {
        const members = await readAll('group_members', 'group_id,user_id', q => q.eq('user_id', userId), 'group_id');
        const owned = await readAll('groups', '*', q => q.eq('owner_id', userId), 'group_id');
        const joined = members.length ? await readAll('groups', '*', q => q.in('group_id', members.map(m => m.group_id)), 'group_id') : [];
        const group = owned[0] || joined[0];
        if (!group) return { message: 'Join or create a group before finding an adviser.' };
        if (group.adviser_id) return { message: 'Your group already has an adviser. View My Group for details.' };
        const applicationResult = await supabase.rpc('get_group_adviser_application', { p_group_id: group.group_id, p_user_id: userId });
        if (applicationResult.error) throw new Error('Unable to check adviser applications.');
        const application = applicationResult.data?.application;
        if (application && ['Pending', 'Accepted'].includes(application.Status)) {
            return { message: 'Your group already has a pending or accepted adviser application. Check it in Adviser.' };
        }
        if (!clip(group.description, 1500)) return { message: 'Add a group description in My Group so advisers can be matched to your project.' };
        const project = await supabase.from('ai_capstone_projects').select('selected_title').eq('group_id', group.group_id).maybeSingle();
        // The optional title-generation tables are not installed in every deployment.
        if (project.error && !['42P01', 'PGRST205'].includes(project.error.code)) throw new Error('Unable to load the group title.');
        const context = { title: clip(group.group_name, 300), project_title: clip(project.data?.selected_title, 300), description: clip(group.description, 1500) };
        const availability = await readAll('adviser_slot_availability', 'user_id,name,bio,course,is_active,expires_at,remaining_slots', q => q.eq('is_active', true));
        const profiles = availability.length ? await readAll('advisers', 'user_id,specialty,skills') : [];
        const byId = new Map(profiles.map(profile => [Number(profile.user_id), profile]));
        const candidates = eligibleAdvisers(group, availability.map(adviser => {
            const profile = byId.get(Number(adviser.user_id));
            return { ...adviser, expertise: clip([profile?.specialty, ...(Array.isArray(profile?.skills) ? profile.skills : []), adviser.bio].filter(Boolean).join('; '), 1000) };
        }));
        return { group, context, candidates, canApply: Number(group.owner_id) === Number(userId) && Boolean(group.finalized_at),
            applicationHint: Number(group.owner_id) !== Number(userId) ? 'Only your group leader can apply.'
                : !group.finalized_at ? 'Finalize your group in My Group before applying.' : '' };
    }
    return async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        const userId = req.user.user_id;
        if (inFlight.has(userId)) return res.status(429).json({ message: 'Adviser matching is already running. Please wait.' });
        inFlight.add(userId);
        try {
            const initial = await load(userId);
            if (initial.message) return res.json({ recommendations: [], message: initial.message });
            if (!initial.candidates.length) return res.json({ recommendations: [], message: 'No advisers with profile expertise and available slots match your group course right now.' });
            const candidates = shortlistAdvisers(initial.context, initial.candidates);
            if (!candidates.length) return res.json({ recommendations: [], message: 'No clear topic matches found in adviser profiles. You can browse advisers or add more specific project details in My Group.' });
            const result = await callAIService('/recommend-advisers', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group: initial.context, advisers: candidates.map(a => ({ adviser_id: Number(a.user_id), expertise: a.expertise })) }),
            });
            const ranked = cleanAdviserRecommendations(result, candidates);
            if (result.recommendations.length && !ranked.length) throw new Error('Unsupported adviser matches.');
            const current = await load(userId);
            if (current.message) return res.json({ recommendations: [], message: current.message });
            if (Number(current.group.group_id) !== Number(initial.group.group_id) || JSON.stringify(current.context) !== JSON.stringify(initial.context)) {
                return res.json({ recommendations: [], message: 'Your group details changed while matching. Refresh matches to use the latest details.' });
            }
            const fresh = current.candidates.filter(a => candidates.some(old => Number(old.user_id) === Number(a.user_id) && old.expertise === a.expertise));
            const recommendations = cleanAdviserRecommendations(result, fresh);
            return res.json({ recommendations, groupName: current.group.group_name, canApply: current.canApply,
                applicationHint: current.applicationHint,
                message: recommendations.length ? 'Advisers matched to your group title and description.' : 'No strong adviser matches found. You can still browse advisers.' });
        } catch (error) {
            console.error('Adviser recommendations failed:', error.message);
            return res.status(503).json({ message: 'Adviser recommendations are temporarily unavailable. Please retry or browse advisers.' });
        } finally {
            inFlight.delete(userId);
        }
    };
}

module.exports = { eligibleAdvisers, shortlistAdvisers, cleanAdviserRecommendations, createAdviserRecommendationHandler };
