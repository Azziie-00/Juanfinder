const { test } = require('node:test');
const assert = require('node:assert/strict');
const { eligibleAdvisers, shortlistAdvisers, cleanAdviserRecommendations, createAdviserRecommendationHandler } = require('./adviser-recommendations');
const group = { group_id: 1, owner_id: 1, group_name: 'Smart farm', description: 'IoT sensors for crop monitoring', course: 'BSIT', finalized_at: '2026-01-01', adviser_id: null };
const adviser = { user_id: 10, name: 'IoT Adviser', bio: 'IoT and embedded systems', expertise: 'IoT and embedded systems', course: ' bsit ', is_active: true, expires_at: null, remaining_slots: 2 };
const match = { adviser_id: 10, reason: 'IoT expertise fits your crop sensors.', evidence: 'IoT' };

function fixture(call = async () => ({ recommendations: [match] })) {
    const state = { groups: [{ ...group }], group_members: [], adviser_slot_availability: [{ ...adviser }],
        users: [{ user_id: 10, role: 'adviser', specialty: 'IoT', skills: ['Sensors'] }],
        ai_capstone_projects: [{ group_id: 1, selected_title: 'Crop sensor network' }], application: null };
    const failures = new Set();
    const supabase = {
        async rpc() { return { data: { application: state.application }, error: failures.has('rpc') ? {} : null }; },
        from(table) {
            const filters = []; let start = 0, end = Infinity, single = false;
            const q = { select() { return q; }, order() { return q; },
                eq(key, value) { filters.push(row => row[key] === value); return q; },
                in(key, values) { filters.push(row => values.includes(row[key])); return q; },
                range(a, b) { start = a; end = b; return q; }, maybeSingle() { single = true; return q; },
                then(resolve) { const rows = state[table].filter(row => filters.every(filter => filter(row))).slice(start, end + 1);
                    return Promise.resolve({ data: single ? rows[0] || null : rows, error: failures.has(table) ? { code: 'offline' } : null }).then(resolve); },
            }; return q;
        },
    };
    let calls = 0;
    const handler = createAdviserRecommendationHandler({ supabase, callAIService: async (...args) => { calls++; return call(state, ...args); } });
    const response = () => ({ statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
    const res = response();
    return { state, failures, res, calls: () => calls, response, run: (id = 1, out = res) => handler({ user: { user_id: id }, body: { group_id: 999, description: 'Forged' } }, out) };
}

test('eligibility excludes unavailable, expired, mismatched, unconfigured and empty profiles', () => {
    const variants = [{}, { is_active: false }, { remaining_slots: 0 }, { expires_at: '2000-01-01' }, { course: 'BSCS' }, { course: 'Unspecified' }, { expertise: '' }];
    assert.equal(eligibleAdvisers(group, variants.map(change => ({ ...adviser, ...change }))).length, 1);
    assert.deepEqual(eligibleAdvisers({ ...group, course: '' }, [adviser]), []);
});

test('output requires a real candidate and actual profile evidence, and removes duplicates', () => {
    const result = cleanAdviserRecommendations({ recommendations: [null, { ...match, adviser_id: '10' }, { ...match, adviser_id: 99 },
        { ...match, evidence: 'Invented experience' }, match, match] }, [adviser]);
    assert.equal(result.length, 1);
    assert.equal(result[0].adviser.name, adviser.name);
});

test('topic shortlist rejects unrelated expertise and boilerplate, recognizes common topic aliases', () => {
    const candidates = [adviser, { ...adviser, user_id: 11, expertise: 'Financial accounting, taxation and audit.' },
        { ...adviser, user_id: 12, expertise: 'AI and SQL' }, { ...adviser, user_id: 13, expertise: 'Capstone project development and research systems' }];
    assert.deepEqual(shortlistAdvisers({ title: 'Tax compliance research', description: 'Study tax compliance for businesses' }, candidates).map(a => a.user_id), [11]);
    assert.deepEqual(shortlistAdvisers({ title: 'Artificial intelligence project', description: 'Machine learning with databases' }, candidates).map(a => a.user_id), [12]);
    assert.deepEqual(shortlistAdvisers({ title: 'Tourist satisfaction', description: 'Study guided walking tours' }, candidates), []);
});

test('server uses saved group title, selected title and description, with no client overrides', async () => {
    const f = fixture(async (_state, path, options) => {
        assert.equal(path, '/recommend-advisers');
        const payload = JSON.parse(options.body);
        assert.deepEqual(payload.group, { title: group.group_name, project_title: 'Crop sensor network', description: group.description });
        assert.equal(payload.advisers[0].expertise, 'IoT; Sensors; IoT and embedded systems');
        assert.equal(options.body.includes('Forged'), false);
        assert.equal(options.body.includes(adviser.name), false);
        return { recommendations: [match] };
    });
    await f.run();
    assert.equal(f.res.body.recommendations.length, 1);
    assert.equal(f.res.body.canApply, true);
});

test('no group, pending join, assigned adviser, active application or missing description skips inference', async () => {
    for (const change of [s => { s.groups = []; }, s => { s.groups[0].owner_id = 2; },
        s => { s.groups[0].adviser_id = 10; }, s => { s.application = { Status: 'Pending' }; },
        s => { s.application = { Status: 'Accepted' }; }, s => { s.groups[0].description = ' '; }]) {
        const f = fixture(); change(f.state); await f.run();
        assert.equal(f.calls(), 0); assert.deepEqual(f.res.body.recommendations, []);
    }
});

test('members and unfinalized leaders may view matches but cannot apply', async () => {
    const f = fixture(); f.state.group_members.push({ group_id: 1, user_id: 2 });
    await f.run(2); assert.equal(f.res.body.canApply, false); assert.match(f.res.body.applicationHint, /leader/);
    f.state.groups[0].finalized_at = null;
    await f.run(); assert.equal(f.res.body.canApply, false); assert.match(f.res.body.applicationHint, /Finalize/);
});

test('capacity, membership, profile, project and application changes during inference remove stale matches', async () => {
    for (const change of [s => { s.adviser_slot_availability[0].remaining_slots = 0; },
        s => { s.groups[0].owner_id = 2; }, s => { s.users[0].specialty = 'Accounting'; },
        s => { s.groups[0].description = 'New project'; }, s => { s.application = { Status: 'Pending' }; }]) {
        const f = fixture(async state => { change(state); return { recommendations: [match] }; });
        await f.run(); assert.deepEqual(f.res.body.recommendations, []);
    }
});

test('shortlist is capped and only eligible profiles are sent', async () => {
    const f = fixture(async (_s, _p, options) => { assert.equal(JSON.parse(options.body).advisers.length, 12); return { recommendations: [] }; });
    f.state.adviser_slot_availability = Array.from({ length: 20 }, (_, i) => ({ ...adviser, user_id: i + 10 }));
    await f.run(); assert.equal(f.res.statusCode, 200);
});

test('database failures and unsupported AI outputs fail closed; no matches is valid', async () => {
    for (const result of [{}, { recommendations: [ { ...match, adviser_id: 999 } ] }]) {
        const f = fixture(async () => result); await f.run(); assert.equal(f.res.statusCode, 503);
    }
    const f = fixture(); f.failures.add('rpc'); await f.run(); assert.equal(f.res.statusCode, 503); assert.equal(f.calls(), 0);
    const empty = fixture(async () => ({ recommendations: [] })); await empty.run(); assert.equal(empty.res.statusCode, 200);
});

test('duplicate requests do not start concurrent inference', async () => {
    let release; let started;
    const pending = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { started = resolve; });
    const f = fixture(async () => { started(); await pending; return { recommendations: [] }; });
    const first = f.run(); await ready;
    const second = f.response(); await f.run(1, second);
    assert.equal(second.statusCode, 429); release(); await first;
    assert.equal(f.calls(), 1);
});
