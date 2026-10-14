// Keep eligibility outside the model: it only ranks server-approved candidates.
const normalize = value => String(value || "").trim().toLowerCase();

function selectCandidates(user, groups, members, requests, now = Date.now()) {
    const userId = Number(user.user_id);
    const occupied = members.some(row => Number(row.user_id) === userId)
        || groups.some(row => Number(row.owner_id) === userId)
        || requests.some(row => Number(row.user_id) === userId && row.status === "Pending" && Date.parse(row.expires_at) > now);
    if (occupied) return { candidates: [], message: "You already have a group or a pending join request." };
    const candidates = groups.flatMap(group => {
        const memberIds = new Set(members.filter(row => Number(row.group_id) === Number(group.group_id)).map(row => Number(row.user_id)));
        if (group.owner_id != null) memberIds.add(Number(group.owner_id));
        if (!normalize(user.course) || normalize(group.course) !== normalize(user.course)
            || group.status !== "Open" || group.finalized_at || memberIds.size >= group.max_members) return [];
        return [{ ...group, member_count: memberIds.size }];
    });
    return { candidates, message: candidates.length ? "" : "No open groups with available places in your course right now." };
}

function cleanRecommendations(payload, candidates, skills) {
    if (!Array.isArray(payload?.recommendations)) throw new Error("Invalid recommendations response.");
    const byId = new Map(candidates.map(group => [Number(group.group_id), group]));
    const knownSkills = new Map(skills.map(skill => [normalize(skill), skill]));
    const seen = new Set();
    return payload.recommendations.flatMap(item => {
        if (!item || !Number.isSafeInteger(item.group_id) || seen.has(item.group_id) || !byId.has(item.group_id)
            || typeof item.reason !== "string" || !item.reason.trim()) return [];
        const matchedSkills = Array.isArray(item.matched_skills)
            ? [...new Set(item.matched_skills.filter(skill => typeof skill === "string").map(skill => knownSkills.get(normalize(skill))).filter(Boolean))] : [];
        if (!matchedSkills.length) return [];
        seen.add(item.group_id);
        const group = byId.get(item.group_id);
        return [{
            group: {
                id: String(group.group_id), name: group.group_name, desc: group.description || "",
                specialty: group.specialty || "", course: group.course, status: group.status,
                members: group.member_count, maxMembers: group.max_members,
                ownerId: group.owner_id, finalizedAt: null,
                availability: `${group.max_members - group.member_count} / ${group.max_members}`,
            },
            reason: item.reason.trim().slice(0, 600), matchedSkills,
        }];
    }).slice(0, 3);
}

function createRecommendationHandler({ supabase, callAIService }) {
    // Supabase caps each response; paginate so large cohorts cannot hide a membership
    // or make an actually full group appear to have room.
    async function readAll(table, columns, orderColumns) {
        const rows = [];
        for (let offset = 0; ; offset += 1000) {
            let query = supabase.from(table).select(columns);
            for (const column of orderColumns) query = query.order(column);
            const result = await query.range(offset, offset + 999);
            if (result.error) throw new Error("Unable to load group eligibility.");
            rows.push(...result.data);
            if (result.data.length < 1000) return rows;
        }
    }
    async function loadCandidates(user) {
        const [groups, members, requests] = await Promise.all([
            readAll("groups", "group_id,group_name,course,specialty,description,owner_id,status,finalized_at,max_members", ["group_id"]),
            readAll("group_members", "group_id,user_id", ["group_id", "user_id"]),
            supabase.from("group_join_requests").select("user_id,status,expires_at").eq("user_id", user.user_id).eq("status", "Pending").gt("expires_at", new Date().toISOString()),
        ]);
        if (requests.error) throw new Error("Unable to load group eligibility.");
        return selectCandidates(user, groups, members, requests.data);
    }
    return async (req, res) => {
        res.set("Cache-Control", "no-store");
        const skills = [...new Set((Array.isArray(req.user.skills) ? req.user.skills : [])
            .filter(skill => typeof skill === "string").map(skill => skill.trim().slice(0, 80)).filter(Boolean))].slice(0, 30);
        if (!skills.length) return res.json({ recommendations: [], needsSkills: true, message: "Add skills to your profile to get personalized group recommendations." });
        try {
            const eligible = await loadCandidates(req.user);
            if (!eligible.candidates.length) return res.json({ recommendations: [], message: eligible.message });
            // Bound the prompt, prioritizing direct skill overlap before semantic ranking.
            const overlap = group => skills.filter(skill => normalize(`${group.specialty} ${group.description}`).includes(normalize(skill))).length;
            const candidates = eligible.candidates.sort((a, b) => overlap(b) - overlap(a) || Number(a.group_id) - Number(b.group_id)).slice(0, 12);
            const result = await callAIService("/recommend-groups", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ skills, groups: candidates.map(group => ({
                    group_id: Number(group.group_id), specialty: String(group.specialty || "").slice(0, 200),
                    description: String(group.description || "").slice(0, 500),
                })) }),
            });
            const ranked = cleanRecommendations(result, candidates, skills);
            if (result.recommendations.length && !ranked.length) throw new Error("Invalid recommendations response.");
            // A group can fill or the student can join while Ollama is running.
            const current = await loadCandidates(req.user);
            const recommendations = cleanRecommendations(result, current.candidates.filter(group => candidates.some(candidate => Number(candidate.group_id) === Number(group.group_id))), skills);
            return res.json({ recommendations, message: recommendations.length ? "" : current.message || "No strong skill matches found. You can still browse the open groups below." });
        } catch (error) {
            console.error("Group recommendations failed:", error.message);
            return res.status(503).json({ success: false, message: "Group recommendations are temporarily unavailable. Please try again; you can still browse groups below." });
        }
    };
}

module.exports = { selectCandidates, cleanRecommendations, createRecommendationHandler };
