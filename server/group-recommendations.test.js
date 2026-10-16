const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectCandidates, cleanRecommendations, createRecommendationHandler } = require('./group-recommendations');

const student = { user_id: 10, course: 'BSIT', skills: ['SQL', 'React'], name: 'Private Name', username: 'private@example.com' };
const group = (id, overrides = {}) => ({ group_id: id, group_name: `Group ${id}`, course: 'bsit', specialty: 'Database / React', description: 'Build a student portal', status: 'Open', finalized_at: null, max_members: 4, owner_id: id + 100, ...overrides });
const match = (id, overrides = {}) => ({ group_id: id, reason: 'SQL supports the database work.', matched_skills: ['SQL'], ...overrides });

test('only same-course open, nonfinalized groups with space are eligible; count unique owners', () => {
    const groups = [group(1), group(2, { status: 'Full' }), group(3, { finalized_at: '2026-01-01' }), group(4, { course: 'BSCS' }), group(5), group(6, { status: 'Closed' })];
    const members = [101, 102, 103, 104].map(user_id => ({ group_id: 5, user_id }));
    members.push({ group_id: 1, user_id: 101 });
    const result = selectCandidates(student, groups, members, []);
    assert.deepEqual(result.candidates.map(item => item.group_id), [1]);
    assert.equal(result.candidates[0].member_count, 1);
});

test('membership, ownership and live pending requests block recommendations, expired requests do not', () => {
    assert.equal(selectCandidates(student, [group(1)], [{ user_id: 10, group_id: 9 }], []).candidates.length, 0);
    assert.equal(selectCandidates(student, [group(1, { owner_id: 10 })], [], []).candidates.length, 0);
    const request = { user_id: 10, status: 'Pending', expires_at: '2099-01-01' };
    assert.equal(selectCandidates(student, [group(1)], [], [request]).candidates.length, 0);
    assert.equal(selectCandidates(student, [group(1)], [], [{ ...request, expires_at: '2000-01-01' }]).candidates.length, 1);
});

test('reject invented IDs, duplicate groups, malformed fields and unsupported skills', () => {
    const candidates = [group(1, { member_count: 1 }), group(2, { member_count: 1 })];
    const result = cleanRecommendations({ recommendations: [null, match(99), match('1'), match(1), match(1), match(2, { matched_skills: ['Invented'] })] }, candidates, student.skills);
    assert.equal(result.length, 1);
    assert.equal(result[0].group.name, 'Group 1');
    assert.deepEqual(result[0].matchedSkills, ['SQL']);
    assert.throws(() => cleanRecommendations({}, candidates, student.skills));
});

function fixture(groups = [group(1)], call = async () => ({ recommendations: [match(1)] })) {
    const state = { groups, group_members: [], group_join_requests: [] };
    let calls = 0;
    const supabase = { from(table) {
        let start = 0, end = Infinity;
        const query = { select() { return this; }, order() { return this; }, eq() { return this; }, gt() { return this; },
            range(from, to) { start = from; end = to; return this; },
            then(resolve) { return Promise.resolve({ data: state[table].slice(start, end + 1), error: null }).then(resolve); } };
        return query;
    } };
    const handler = createRecommendationHandler({ supabase, callAIService: async (...args) => { calls++; return call(...args); } });
    const res = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    return { state, res, run: (user = student) => handler({ user, body: { skills: ['Hacking'], user_id: 999 } }, res), calls: () => calls };
}

test('empty profile and no candidates skip inference', async () => {
    const f = fixture();
    await f.run({ ...student, skills: [] });
    assert.equal(f.res.body.needsSkills, true);
    assert.equal(f.calls(), 0);
    f.state.groups = [];
    await f.run();
    assert.deepEqual(f.res.body.recommendations, []);
    assert.equal(f.calls(), 0);
});

test('model receives server-owned skills and a bounded shortlist without student personal details', async () => {
    const f = fixture(Array.from({ length: 15 }, (_, i) => group(i + 1)), async (path, options) => {
        assert.equal(path, '/recommend-groups');
        const body = JSON.parse(options.body);
        assert.deepEqual(body.skills, student.skills);
        assert.equal(body.groups.length, 12);
        assert.equal(options.body.includes(student.name), false);
        assert.equal(options.body.includes(student.username), false);
        assert.equal(options.body.includes('Hacking'), false);
        return { recommendations: [match(1)] };
    });
    await f.run();
    assert.equal(f.res.body.recommendations.length, 1);
});

test('groups filled during inference are removed', async () => {
    const f = fixture([group(1)], async () => {
        f.state.group_members = [101, 102, 103, 104].map(user_id => ({ group_id: 1, user_id }));
        return { recommendations: [match(1)] };
    });
    await f.run();
    assert.deepEqual(f.res.body.recommendations, []);
});

test('student joining another group during inference suppresses matches', async () => {
    const f = fixture([group(1)], async () => {
        f.state.group_members = [{ group_id: 9, user_id: 10 }];
        return { recommendations: [match(1)] };
    });
    await f.run();
    assert.deepEqual(f.res.body.recommendations, []);
});

test('membership beyond the first database page still blocks inference', async () => {
    const f = fixture();
    f.state.group_members = Array.from({ length: 1000 }, (_, i) => ({ group_id: i + 20, user_id: i + 100 }));
    f.state.group_members.push({ group_id: 2000, user_id: 10 });
    await f.run();
    assert.deepEqual(f.res.body.recommendations, []);
    assert.equal(f.calls(), 0);
});

test('unavailable AI and malformed responses return a retryable error, not fake matches', async () => {
    for (const call of [async () => { throw new Error('Offline'); }, async () => ({}), async () => ({ recommendations: [match(999)] })]) {
        const f = fixture([group(1)], call);
        await f.run();
        assert.equal(f.res.statusCode, 503);
        assert.match(f.res.body.message, /temporarily unavailable/);
    }
});

test('HTTP route enforces bearer authentication and student role, ignoring client-supplied profiles', async () => {
    const http = require('node:http');
    let role = 'adviser';
    let modelCalls = 0;
    let adviserMatching = false;
    const upstream = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        res.setHeader('Content-Type', 'application/json');
        let data;
        if (url.pathname === '/rest/v1/auth_sessions') data = { user_id: 10, expires_at: '2099-01-01' };
        else if (url.pathname === '/rest/v1/users') data = url.searchParams.get('select') === 'user_id,specialty,skills'
            ? [{ user_id: 20, specialty: 'Database', skills: ['SQL'] }]
            : { ...student, role, is_active: true };
        else if (url.pathname === '/rest/v1/groups') data = [group(1, adviserMatching ? { owner_id: 10, finalized_at: '2026-01-01', description: 'Build a database student portal' } : {})];
        else if (url.pathname === '/rest/v1/rpc/get_group_adviser_application') data = { application: null };
        else if (url.pathname === '/rest/v1/ai_capstone_projects') data = { selected_title: 'Student portal' };
        else if (url.pathname === '/rest/v1/adviser_slot_availability') data = [{ user_id: 20, name: 'Database Adviser', course: 'BSIT', bio: 'Database systems', is_active: true, remaining_slots: 2 }];
        else if (url.pathname === '/rest/v1/group_members' || url.pathname === '/rest/v1/group_join_requests') data = [];
        else if (url.pathname === '/recommend-groups') {
            modelCalls++;
            let raw = '';
            for await (const chunk of req) raw += chunk;
            assert.deepEqual(JSON.parse(raw).skills, student.skills);
            assert.equal(req.headers['x-ai-service-token'], 'test-shared-secret');
            data = { recommendations: [match(1)] };
        } else if (url.pathname === '/recommend-advisers') {
            modelCalls++;
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const payload = JSON.parse(raw);
            assert.equal(payload.group.title, 'Group 1');
            assert.equal(payload.group.description, 'Build a database student portal');
            assert.equal(req.headers['x-ai-service-token'], 'test-shared-secret');
            data = { recommendations: [{ adviser_id: 20, reason: 'Database expertise fits the portal.', evidence: 'Database' }] };
        } else { res.statusCode = 404; data = {}; }
        res.end(JSON.stringify(data));
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${upstream.address().port}`;
    const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AI_SERVICE_URL', 'AI_SERVICE_TOKEN'];
    const previous = keys.map(key => process.env[key]);
    Object.assign(process.env, { SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: 'test-key', AI_SERVICE_URL: origin, AI_SERVICE_TOKEN: 'test-shared-secret' });
    let server;
    try {
        const app = require('./supabase-server');
        server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
        const endpoint = `http://127.0.0.1:${server.address().port}/api/groups/recommendations`;
        assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
        const headers = { Authorization: `Bearer ${'a'.repeat(64)}`, 'Content-Type': 'application/json' };
        assert.equal((await fetch(endpoint, { method: 'POST', headers })).status, 403);
        role = 'student';
        const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ user_id: 999, skills: ['Invented'] }) });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await response.json()).recommendations[0].group.id, '1');
        assert.equal(modelCalls, 1);
        adviserMatching = true;
        const adviserEndpoint = endpoint.replace('/groups/', '/advisers/');
        assert.equal((await fetch(adviserEndpoint, { method: 'POST' })).status, 401);
        role = 'adviser';
        assert.equal((await fetch(adviserEndpoint, { method: 'POST', headers })).status, 403);
        role = 'student';
        const adviserResponse = await fetch(adviserEndpoint, { method: 'POST', headers, body: JSON.stringify({ group_id: 999, title: 'Forged title' }) });
        assert.equal(adviserResponse.status, 200);
        assert.equal(adviserResponse.headers.get('cache-control'), 'private, no-store');
        const adviserResult = await adviserResponse.json();
        assert.equal(adviserResult.recommendations[0].adviser.id, '20');
        assert.equal(adviserResult.canApply, true);
        assert.equal(modelCalls, 2);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        await new Promise(resolve => upstream.close(resolve));
        keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    }
});
