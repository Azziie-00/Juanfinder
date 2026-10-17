const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

let db;
let httpServer;
let origin;
const storage = { files: new Map(), removed: [], uploads: 0, failAt: 0 };
const migration = name => fs.readFileSync(path.join(__dirname, 'migrations', name), 'utf8');
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const submit = (group = 1, leader = 1, adviser = 10) => scalar('select public.submit_group_adviser_application($1,$2,$3)', [group, leader, adviser]);
const respond = (id, adviser = 10, accept = true) => scalar('select public.respond_to_group_adviser_application($1,$2,$3)', [id, adviser, accept]);
const slots = () => db.query('select assigned_groups, remaining_slots from adviser_slot_availability where user_id=10').then(r => r.rows[0]);

test('self-service password changes validate current credentials, persist for all three roles and revoke only other sessions', () => fixture(async () => {
    const bcrypt = require('bcryptjs');
    const oldPassword = 'OriginalPass!23', newPassword = 'UpdatedPass!45';
    const hash = await bcrypt.hash(oldPassword, 4);
    await db.exec("update users set role='library' where user_id=9");
    for (const id of [1, 10, 9]) {
        await db.query('update users set password_hash=$1 where user_id=$2', [hash, id]);
        await db.query("insert into auth_sessions(session_hash,user_id,expires_at) values ($1,$2,now()+interval '1 hour')", ['other-session-' + id, id]);
        const body = { currentPassword: oldPassword, newPassword, confirmPassword: newPassword, userId: 11 };
        assert.equal((await request('/account/password', id, { ...body, currentPassword: 'wrong' })).status, 400);
        assert.equal((await request('/account/password', id, { ...body, confirmPassword: 'mismatch' })).status, 400);
        assert.equal((await request('/account/password', id, { ...body, newPassword: 'weakpass', confirmPassword: 'weakpass' })).status, 400);
        assert.equal((await request('/account/password', id, { ...body, newPassword: oldPassword, confirmPassword: oldPassword })).status, 400);
        assert.equal((await request('/account/password', id, { ...body, newPassword: 'A1!' + 'é'.repeat(36), confirmPassword: 'A1!' + 'é'.repeat(36) })).status, 400);
        assert.equal((await request('/account/password', id, body)).status, 200);
        const stored = await scalar('select password_hash from users where user_id=$1', [id]);
        assert.notEqual(stored, newPassword); assert.equal(await bcrypt.compare(newPassword, stored), true);
        assert.equal(await bcrypt.compare(oldPassword, stored), false);
        assert.equal(await scalar('select count(*) from auth_sessions where user_id=$1', [id]), 1);
        assert.equal((await request('/profile', id)).status, 200);
        const role = id === 1 ? 'student' : id === 10 ? 'adviser' : 'library';
        assert.equal((await request('/login', id, { username: `user${id}`, password: oldPassword, role })).status, 401);
        assert.equal((await request('/login', id, { username: `user${id}`, password: newPassword, role })).status, 200);
        // A stale credential snapshot cannot overwrite a newer password.
        const sessionHash = require('node:crypto').createHash('sha256').update(token(id)).digest('hex');
        assert.equal(await scalar('select change_account_password($1,$2,$3)', [sessionHash, hash, stored]), false);
    }
    assert.equal(await scalar('select password_hash from users where user_id=11'), 'unused');
    assert.equal((await request('/account/password', 999, {})).status, 401);
    await db.exec("update users set role='admin' where user_id=9");
    assert.equal((await request('/account/password', 9, {})).status, 403);
    await db.exec("update users set password_change_required=true where user_id=1");
    assert.equal((await request('/account/password', 1, {})).status, 403);
    await db.exec(migration('016_change_account_password.sql').replace(/^BEGIN;|^COMMIT;/gm, ''));
    for (const role of ['anon', 'authenticated']) assert.equal(await scalar("select has_function_privilege($1,'public.change_account_password(text,text,text)','EXECUTE')", [role]), false);
}));

test('dashboard without 014 returns the same scoped report, counts, searches and legacy owners', () => fixture(async () => {
    await db.exec('update advisers set adviser_capacity=4 where user_id=10');
    await respond(await submit()); await respond(await submit(2, 3, 11), 11);
    await db.exec('delete from group_members where user_id=1; update groups set adviser_id=10 where group_id=3');
    const expected = (await request('/adviser/dashboard', 10)).body;
    await db.exec('drop function get_adviser_dashboard_report(bigint,text)');
    storage.pageCap = 1;
    const actual = await request('/adviser/dashboard?adviserId=11', 10);
    assert.equal(actual.status, 200); assert.deepEqual(actual.body, expected);
    assert.deepEqual(actual.body.Summary, { Groups: 2, StudentMembers: 3, Capacity: 4, AvailableSlots: 2 });
    for (const search of ['USER 2', 'CODE2']) {
        const filtered = await request('/adviser/dashboard?search=' + encodeURIComponent(search), 10);
        assert.deepEqual(filtered.body.Groups.map(g => g.GroupID), [1]);
        assert.deepEqual(filtered.body.Summary, expected.Summary);
    }
    assert.deepEqual((await request('/adviser/dashboard?search=code3', 10)).body.Groups, []);
    assert.deepEqual((await request('/adviser/dashboard?search=%25', 10)).body.Groups, []);
    assert.deepEqual((await request('/adviser/dashboard?search=code1&adviserId=10', 11)).body.Groups, []);
    assert.equal((await request('/adviser/dashboard', 1)).status, 403);
    storage.dashboardRpcError = { code: 'PGRST202' };
    assert.deepEqual((await request('/adviser/dashboard', 10)).body, expected);
    // Reproduce a deployed 014 function that still references users profile columns.
    await db.exec('set local check_function_bodies = off');
    await db.exec(migration('014_adviser_dashboard_report.sql'));
    storage.dashboardRpcError = null;
    assert.deepEqual((await request('/adviser/dashboard', 10)).body, expected);
    assert.deepEqual((await request('/adviser/dashboard?search=code2&adviserId=11', 10)).body.Groups.map(g => g.GroupID), [1]);
    assert.deepEqual((await request('/adviser/dashboard?search=code3&adviserId=10', 11)).body.Groups.map(g => g.GroupID), [2]);
    await db.exec(migration('017_repair_adviser_dashboard_report.sql').replace(/^BEGIN;|^COMMIT;/gm, ''));
    assert.deepEqual((await request('/adviser/dashboard', 10)).body, expected);
    for (const role of ['anon', 'authenticated']) {
        assert.equal(await scalar("select has_function_privilege($1,'public.get_adviser_dashboard_report(bigint,text)','EXECUTE')", [role]), false);
    }
    storage.dashboardRpcError = { code: '42703', message: 'column unrelated_secret does not exist' };
    assert.equal((await request('/adviser/dashboard', 10)).status, 503);
    storage.dashboardRpcError = { code: '42501' };
    assert.equal((await request('/adviser/dashboard', 10)).status, 503);
    storage.dashboardRpcError = null;
    await db.exec('alter table group_members rename to unavailable_members');
    assert.equal((await request('/adviser/dashboard', 10)).status, 503);
}));

test('dashboard fallback includes every group/student across server row caps and export pages', () => fixture(async () => {
    await db.exec(`update advisers set adviser_capacity=1200 where user_id=10;
        insert into users(user_id,user_code,username,password_hash,name,role)
        select n, 'SID'||lpad(n::text,6,'0'), 'report.user'||n, 'unused', 'Report Student '||n, 'student' from generate_series(100,1200) n;
        update students set course='BSIT' where user_id between 100 and 1200;
        insert into groups(group_id,group_name,course,owner_id,adviser_id) select n, 'Report '||n, 'BSIT', n, 10 from generate_series(100,1200) n;
        insert into group_members(group_id,user_id) select n,n from generate_series(100,1200) n;`);
    await db.exec('drop function get_adviser_dashboard_report(bigint,text)');
    storage.pageCap = 37;
    const report = await request('/adviser/dashboard', 10);
    assert.equal(report.status, 200);
    assert.equal(report.body.Groups.length, 1101);
    assert.deepEqual(report.body.Summary, { Groups: 1101, StudentMembers: 1101, Capacity: 1200, AvailableSlots: 99 });
    assert.equal(new Set(report.body.Groups.flatMap(g => g.Members.map(s => s.UserID))).size, 1101);
    const search = await request('/adviser/dashboard?search=SID001200', 10);
    assert.deepEqual(search.body.Groups.map(g => g.GroupID), [1200]);
}));

test('missing optional 015 does not block authentication, dashboard or logout, and history stays honest', () => fixture(async () => {
    await respond(await submit());
    await db.exec(`drop function get_adviser_dashboard_report(bigint,text);
        drop trigger auth_session_website_activity on auth_sessions;
        drop function record_website_activity(text);
        alter table auth_sessions drop column previous_activity_at;`);
    assert.equal((await request('/adviser/dashboard', 10)).status, 200);
    const profile = await request('/profile', 10);
    assert.equal(profile.status, 200); assert.equal(profile.body.ActivityTrackingAvailable, false); assert.equal(profile.body.PreviousActivityAt, null);
    const activity = await request('/activity', 10, {});
    assert.equal(activity.status, 202); assert.equal(activity.body.trackingAvailable, false);
    assert.equal((await request('/logout', 10, {})).status, 200);
    assert.equal((await request('/profile', 10)).status, 401);
}));

test('website activity persists across real logout/login and keeps each session history private and stable', () => fixture(async () => {
    const password = 'ActivityTest!23';
    const passwordHash = await require('bcryptjs').hash(password, 4);
    const authed = async (sessionToken, route, body, method = body ? 'POST' : 'GET') => {
        const response = await fetch(origin + route, { method, headers: { authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
    };
    for (const [id, role] of [[1, 'student'], [10, 'adviser']]) {
        await db.query('delete from auth_sessions where user_id=$1', [id]);
        await db.query('update users set last_activity_at=null, password_hash=$1 where user_id=$2', [passwordHash, id]);
        const otherBefore = await scalar('select last_activity_at from users where user_id=2');
        assert.equal((await request('/login', id, { username: `user${id}`, password: 'wrong', role })).status, 401);
        assert.equal(await scalar('select last_activity_at from users where user_id=$1', [id]), null);
        const first = await request('/login', id, { username: `user${id}`, password, role });
        assert.equal(first.status, 200);
        const firstToken = first.body.user.sessionToken;
        assert.equal((await authed(firstToken, '/profile')).body.PreviousActivityAt, null);
        assert.equal((await authed(firstToken, '/activity', { userId: 2, lastActivityAt: '2099-01-01' })).status, 200);
        assert.deepEqual(await scalar('select last_activity_at from users where user_id=2'), otherBefore);
        assert.equal((await authed(firstToken, '/profile?userId=2')).body.PreviousActivityAt, null);
        assert.equal((await authed(firstToken, '/logout', {})).status, 200);
        const endedAt = new Date(await scalar('select last_activity_at from users where user_id=$1', [id])).toISOString();
        assert.equal((await authed(firstToken, '/activity', {})).status, 401);
        const second = await request('/login', id, { username: `user${id}`, password, role });
        assert.equal(second.status, 200);
        const secondToken = second.body.user.sessionToken;
        assert.equal((await authed(secondToken, '/profile')).body.PreviousActivityAt, endedAt);
        await authed(secondToken, '/activity', {});
        await authed(secondToken, '/notifications'); // Background reads must not move saved activity.
        assert.equal((await authed(secondToken, '/profile')).body.PreviousActivityAt, endedAt);
        const beforeMigration = await db.query('select * from auth_sessions where user_id=$1 order by created_at', [id]);
        await db.exec(migration('015_website_activity.sql'));
        assert.deepEqual((await db.query('select * from auth_sessions where user_id=$1 order by created_at', [id])).rows, beforeMigration.rows);
        const currentTime = new Date(await scalar('select last_activity_at from users where user_id=$1', [id])).toISOString();
        const third = await request('/login', id, { username: `user${id}`, password, role });
        assert.equal((await authed(third.body.user.sessionToken, '/profile')).body.PreviousActivityAt, currentTime);
        assert.equal((await authed(secondToken, '/profile')).body.PreviousActivityAt, endedAt);
    }
    assert.equal((await request('/activity', 99, {})).status, 401);
    await fails(() => db.exec("SET LOCAL ROLE authenticated; SELECT record_website_activity('anything')"), /permission denied/);
    await fails(() => db.exec("SET LOCAL ROLE anon; SELECT record_website_activity('anything')"), /permission denied/);
}));

test('expired sessions cannot record activity and session cleanup preserves account history', () => fixture(async () => {
    const sessionHash = require('node:crypto').createHash('sha256').update(token(1)).digest('hex');
    await db.query("update auth_sessions set expires_at=clock_timestamp()-interval '1 minute' where session_hash=$1", [sessionHash]);
    const previous = await scalar('select last_activity_at from users where user_id=1');
    assert.equal(await scalar('select record_website_activity($1)', [sessionHash]), null);
    assert.equal((await request('/activity', 1, {})).status, 401);
    await db.query('delete from auth_sessions where session_hash=$1', [sessionHash]);
    assert.deepEqual(await scalar('select last_activity_at from users where user_id=1'), previous);
}));

test('dashboard counts assigned groups and unique members, includes legacy owners and scopes student search', () => fixture(async () => {
    await respond(await submit());
    await db.exec('delete from group_members where user_id=1; update advisers set adviser_capacity=3 where user_id=10');
    const report = await request('/adviser/dashboard?adviserId=11', 10);
    assert.equal(report.status, 200);
    assert.equal(report.body.AdviserName, 'User 10');
    assert.deepEqual(report.body.Summary, { Groups: 1, StudentMembers: 2, Capacity: 3, AvailableSlots: 2 });
    assert.equal(report.body.Groups[0].MemberCount, 2);
    assert.deepEqual(report.body.Groups[0].Members.map(s => s.UserCode), ['code1', 'code2']);
    for (const term of ['USER 2', 'CODE2']) {
        const result = await request('/adviser/dashboard?search=' + encodeURIComponent(term), 10);
        assert.deepEqual(result.body.Groups.map(g => g.GroupID), [1]);
        assert.equal(result.body.Summary.StudentMembers, 2);
    }
    assert.deepEqual((await request('/adviser/dashboard?search=code3', 10)).body.Groups, []);
    assert.deepEqual((await request('/adviser/dashboard?search=%25', 10)).body.Groups, []);
    assert.deepEqual((await request('/adviser/dashboard?search=code1&adviserId=10', 11)).body.Groups, []);
    assert.equal((await request('/adviser/dashboard', 1)).status, 403);
    assert.equal((await request('/adviser/dashboard', 99)).status, 401);
    assert.equal((await request('/adviser/dashboard?search=' + 'a'.repeat(201), 10)).status, 400);
    await db.exec('update advisers set adviser_capacity=0 where user_id=10');
    assert.equal((await request('/adviser/dashboard', 10)).body.Summary.AvailableSlots, 0);
    await fails(() => db.exec('SET LOCAL ROLE authenticated; SELECT get_adviser_dashboard_report(10,\'\')'), /permission denied/);
}));

test('dashboard report has no API page limit and migration reruns preserve assignments', () => fixture(async () => {
    await db.exec(`update advisers set adviser_capacity=1200 where user_id=10;
        insert into groups(group_id,group_name,course,adviser_id) select n, 'Report '||n, 'BSIT', 10 from generate_series(100,1200) n`);
    const result = await request('/adviser/dashboard', 10);
    assert.equal(result.body.Groups.length, 1101);
    assert.equal(result.body.Summary.Groups, 1101);
    assert.equal(result.body.Summary.AvailableSlots, 99);
    await db.exec(migration('015_separate_role_profiles.sql')
        .replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''));
    assert.equal((await request('/adviser/dashboard', 10)).body.Groups.length, 1101);
}));

test('adviser skills and specialties persist privately, validate limits and preserve omitted fields', () => fixture(async () => {
    const expertise = { bio: 'Adviser bio', requirements: ['Proposal'], gender: '', skills: [' Python ', 'Data Analysis', 'Python', ''], specialty: ' Artificial Intelligence ', userId: 11 };
    assert.equal((await request('/adviser/profile', 10, expertise, 'PATCH')).status, 200);
    let profile = (await request('/profile', 10)).body;
    assert.deepEqual(profile.Skills, ['Python', 'Data Analysis']); assert.equal(profile.Specialty, 'Artificial Intelligence');
    assert.deepEqual((await request('/profile', 11)).body.Skills, []);
    assert.equal((await request('/profile', 11)).body.Specialty, '');
    assert.equal((await request('/adviser/profile', 10, { bio: 'Changed bio', requirements: ['Proposal'] }, 'PATCH')).status, 200);
    assert.deepEqual((await request('/profile', 10)).body.Skills, profile.Skills);
    assert.equal((await request('/profile', 10)).body.Specialty, profile.Specialty);
    for (const invalid of [{ skills: 'Python' }, { skills: [123] }, { skills: Array.from({ length: 31 }, (_, i) => `Skill ${i}`) }, { skills: ['x'.repeat(81)] }, { specialty: 'x'.repeat(501) }, { specialty: {} }]) {
        assert.equal((await request('/adviser/profile', 10, { ...expertise, ...invalid }, 'PATCH')).status, 400);
    }
    assert.deepEqual((await request('/profile', 10)).body.Skills, profile.Skills);
    assert.equal((await request('/adviser/profile', 1, expertise, 'PATCH')).status, 403);
    assert.equal((await request('/adviser/profile', 10, { ...expertise, skills: [], specialty: '' }, 'PATCH')).status, 200);
    profile = (await request('/profile', 10)).body;
    assert.deepEqual(profile.Skills, []); assert.equal(profile.Specialty, '');
}));

test('Settings profile APIs persist only permitted fields on the signed-in account', () => fixture(async () => {
    const student = { firstName: '  Juan ', lastName: ' Santos ', bio: ' Updated bio ', gender: 'Male', socials: 'example', skills: ['Coding'], birthdate: '2001-01-01', userId: 2, role: 'admin', course: 'BSCS' };
    assert.equal((await request('/profile', 1, student, 'PATCH')).status, 200);
    const profile = (await request('/profile', 1)).body;
    assert.equal(profile.Name, 'Juan Santos'); assert.equal(profile.Bio, 'Updated bio');
    assert.equal(profile.Course, 'BSIT'); assert.deepEqual(profile.Skills, ['Coding']);
    assert.equal((await request('/profile', 2)).body.Name, 'User 2');
    assert.equal((await request('/profile', 1, { ...student, firstName: '' }, 'PATCH')).status, 400);
    assert.equal((await request('/profile', 10, student, 'PATCH')).status, 403);
    const adviser = { bio: ' Adviser bio ', gender: 'Female', requirements: [' Research proposal ', 'Schedule'], userId: 11, adviserCapacity: 99 };
    assert.equal((await request('/adviser/profile', 10, adviser, 'PATCH')).status, 200);
    assert.equal((await request('/profile', 10)).body.Requirements, 'Research proposal\nSchedule');
    assert.equal((await request('/profile', 11)).body.Bio, '');
    assert.equal(await scalar('select adviser_capacity from advisers where user_id=10'), 1);
    assert.equal((await request('/adviser/profile', 1, adviser, 'PATCH')).status, 403);
    assert.equal((await request('/adviser/profile', 10, { ...adviser, requirements: ['x'.repeat(251)] }, 'PATCH')).status, 400);
}));

before(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
        CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text primary key, name text, public boolean,
        file_size_limit bigint, allowed_mime_types text[]);`);
    // Real base schema, excluding the sample-account section and its pgcrypto dependency.
    const base = fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf8')
        .split('INSERT INTO public.users (user_code')[0].replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '');
    await db.exec(base);
    for (const name of fs.readdirSync(path.join(__dirname, 'migrations')).filter(n => n.endsWith('.sql')).sort()) {
        await db.exec(migration(name));
    }
    await db.exec(fs.readFileSync(path.join(__dirname, 'check-adviser-workflow.sql'), 'utf8'));
    // Exercise the real Express routes and auth middleware against the isolated SQL database.
    // Only the Supabase transport is replaced; RPCs run the actual migrated PL/pgSQL.
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(name, ...args) {
        if (name === '@supabase/supabase-js') return { createClient: () => sqlTransport() };
        return originalLoad.call(this, name, ...args);
    };
    process.env.SUPABASE_URL ||= 'https://isolated.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'isolated-test-key';
    let app;
    try { app = require('./supabase-server'); } finally { Module._load = originalLoad; }
    httpServer = app.listen(0, '127.0.0.1');
    await new Promise(resolve => httpServer.once('listening', resolve));
    origin = `http://127.0.0.1:${httpServer.address().port}/api`;
});
after(async () => {
    if (httpServer) await new Promise(resolve => httpServer.close(resolve));
    await db?.close();
});

function sqlTransport() {
    let queue = Promise.resolve();
    const run = (sql, params) => {
        const task = queue.then(async () => {
            await db.exec('SAVEPOINT transport');
            try {
                const result = await db.query(sql, params);
                await db.exec('RELEASE SAVEPOINT transport');
                return { data: result.rows, error: null };
            } catch (error) {
                await db.exec('ROLLBACK TO SAVEPOINT transport; RELEASE SAVEPOINT transport');
                return { data: null, error: { code: error.code, message: error.message } };
            }
        });
        queue = task.then(() => {});
        return task;
    };
    return {
        storage: { from() { return {
            async upload(key, buffer, options) {
                if (++storage.uploads === storage.failAt) return { error: new Error('Upload unavailable') };
                storage.files.set(key, { buffer, options }); return { error: null };
            },
            async remove(keys) { storage.removed.push(...keys); keys.forEach(key => storage.files.delete(key)); return { error: null }; },
            async createSignedUrl(key, expires, options) { return { data: { signedUrl: 'https://storage.test/' + key + (options?.download ? '?download=' + options.download : '') }, error: null }; },
            async download(key) { return storage.files.has(key) ? { data: new Blob([storage.files.get(key).buffer]), error: null } : { data: null, error: new Error('File missing') }; },
        }; } },
        rpc(name, args = {}) {
            if (storage.dashboardRpcError && name === 'get_adviser_dashboard_report') return Promise.resolve({ data: null, error: storage.dashboardRpcError });
            if (storage.expiryFails && name === 'expire_group_adviser_applications') return Promise.resolve({ data: null, error: { code: '57014' } });
            const values = Object.entries(args).map(([key, value]) =>
                value && typeof value === 'object' && !(name === 'update_student_profile' && key === 'p_skills')
                    ? JSON.stringify(value)
                    : value);
            return run(`select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) as result`, values)
                .then(r => ({ ...r, data: r.data?.[0].result }));
        },
        from(table) {
            const where = [], values = [], order = [];
            let columns = '*', limit = '', single = false, mutation = '';
            const q = {
                select(value) { columns = value; return q; },
                eq(key, value) { values.push(value); where.push(`${key}=$${values.length}`); return q; },
                neq(key, value) { values.push(value); where.push(`${key}<>$${values.length}`); return q; },
                or(filter) {
                    where.push(`(${filter.split(',').map(part => {
                        const [key, ...rest] = part.split('.eq.'); values.push(rest.join('.eq.')); return `${key}=$${values.length}`;
                    }).join(' or ')})`); return q;
                },
                insert(record) {
                    const entries = Object.entries(record); values.push(...entries.map(([,value]) => value));
                    mutation = `insert into public.${table} (${entries.map(([key]) => key).join(',')}) values (${values.map((_,i) => `$${i+1}`).join(',')})`;
                    return q;
                },
                delete() { mutation = `delete from public.${table}`; return q; },
                update(record) {
                    mutation = `update public.${table} set ${Object.entries(record).map(([key,value]) => { values.push(value); return `${key}=$${values.length}`; }).join(',')}`;
                    return q;
                },
                lt(key, value) { values.push(value); where.push(`${key}<$${values.length}`); return q; },
                gt(key, value) { values.push(value); where.push(`${key}>$${values.length}`); return q; },
                in(key, list) { where.push(`${key} in (${list.map(value => { values.push(value); return `$${values.length}`; }).join(',')})`); return q; },
                order(key, opts) { order.push(`${key} ${opts?.ascending === false ? 'desc' : 'asc'}`); return q; },
                limit(n) { limit = `limit ${Number(n)}`; return q; },
                range(start, end) { limit = `limit ${Math.min(end - start + 1, storage.pageCap || Infinity)} offset ${start}`; return q; },
                maybeSingle() { single = true; return q; },
                single() { single = true; return q; },
                then(resolve, reject) {
                    if (storage.metadataLookupFails && table === 'group_adviser_application_documents' && !mutation) return Promise.resolve({ data: null, error: { code: '57014' } }).then(resolve, reject);
                    const sql = mutation ? `${mutation} ${where.length ? `where ${where.join(' and ')}` : ''} returning ${columns}`
                        : `select ${columns} from public.${table} ${where.length ? `where ${where.join(' and ')}` : ''} ${order.length ? `order by ${order.join(',')}` : ''} ${limit}`;
                    return run(sql, values)
                        .then(r => single ? { ...r, data: r.data?.[0] ?? null } : r).then(resolve, reject);
                },
            };
            return q;
        },
    };
}

const token = id => id.toString(16).padStart(64, '0');
async function request(route, id, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(origin + route, {
        method,
        headers: { authorization: `Bearer ${token(id)}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
}

async function fixture(run) {
    storage.pageCap = null; storage.dashboardRpcError = null;
    storage.files.clear(); storage.removed = []; storage.uploads = 0; storage.failAt = 0; storage.metadataLookupFails = false; storage.expiryFails = false;
    await db.exec(`BEGIN;
        INSERT INTO users(user_id,user_code,username,password_hash,name,role)
        SELECT n, 'code'||n, 'user'||n, 'unused', 'User '||n, CASE WHEN n>=10 THEN 'adviser' ELSE 'student' END
        FROM generate_series(1,11) n;
        UPDATE students SET course='BSIT' WHERE user_id BETWEEN 1 AND 9;
        UPDATE advisers SET course='BSIT', adviser_capacity=1 WHERE user_id BETWEEN 10 AND 11;
        INSERT INTO groups(group_id,group_name,course,owner_id,finalized_at) VALUES
            (1,'First','BSIT',1,now()),(2,'Second','BSIT',3,now()),(3,'Third','BSIT',5,NULL);
        INSERT INTO group_members(group_id,user_id) VALUES (1,1),(1,2),(2,3),(2,4),(3,5);`);
    for (const id of [1, 2, 3, 5, 9, 10, 11]) {
        const hash = require('node:crypto').createHash('sha256').update(token(id)).digest('hex');
        await db.query("insert into auth_sessions(session_hash,user_id,expires_at) values($1,$2,now()+interval '1 hour')", [hash, id]);
    }
    try { await run(); } finally { await db.exec('ROLLBACK'); }
}
// A failed statement aborts its transaction. Savepoints also prove failures leave no partial writes.
async function fails(run, pattern) {
    await db.exec('SAVEPOINT expected_failure');
    await assert.rejects(run, pattern);
    await db.exec('ROLLBACK TO SAVEPOINT expected_failure');
}

test('submission persists Pending with group/adviser/leader and consumes no slot', () => fixture(async () => {
    const id = await submit();
    assert.deepEqual((await db.query('select group_id,adviser_id,applicant_id,status from group_adviser_applications where application_id=$1', [id])).rows[0],
        { group_id: 1, adviser_id: 10, applicant_id: 1, status: 'Pending' });
    assert.deepEqual(await slots(), { assigned_groups: 0, remaining_slots: 1 });
}));
test('only active student leader of a finalized group can submit', () => fixture(async () => {
    await fails(() => submit(1, 2), /Only the group leader/);
    await fails(() => submit(3, 5), /finalized/);
    await fails(() => submit(1, null), /Only the group leader/);
    await db.exec("update users set expires_at=now()-interval '1 day' where user_id=1");
    await fails(() => submit(), /Only active students/);
    assert.equal(await scalar('select count(*)::int from group_adviser_applications'), 0);
}));
test('duplicate active submissions, including another adviser, are rejected', () => fixture(async () => {
    await submit();
    await fails(() => submit(), /active adviser application/);
    await fails(() => submit(1, 1, 11), /active adviser application/);
    assert.equal(await scalar('select count(*)::int from group_adviser_applications'), 1);
}));
test('acceptance persists group link, every member and exactly one slot; repeat response cannot double count', () => fixture(async () => {
    const id = await submit();
    assert.equal(await respond(id), 'Accepted');
    assert.equal(await scalar('select adviser_id from groups where group_id=1'), 10);
    assert.equal(await scalar('select count(*)::int from students where user_id in (1,2) and adviser_id=10'), 2);
    assert.equal(await scalar('select status from group_adviser_applications where application_id=$1', [id]), 'Accepted');
    assert.deepEqual(await slots(), { assigned_groups: 1, remaining_slots: 0 });
    await fails(() => respond(id), /already been processed/);
    await fails(() => submit(1, 1, 11), /already assigned/);
    await fails(() => db.exec('update groups set adviser_id=11 where group_id=1'), /permanent/);
}));
test('leader omitted from legacy membership rows is still assigned', () => fixture(async () => {
    await db.exec('delete from group_members where user_id=1');
    await respond(await submit());
    assert.equal(await scalar('select adviser_id from students where user_id=1'), 10);
    assert.deepEqual(await slots(), { assigned_groups: 1, remaining_slots: 0 });
}));
test('rejection consumes no slot, preserves history and allows reapplication', () => fixture(async () => {
    const first = await submit();
    assert.equal(await respond(first, 10, false), 'Rejected');
    assert.deepEqual(await slots(), { assigned_groups: 0, remaining_slots: 1 });
    assert.equal(await scalar('select adviser_id from students where user_id=1'), null);
    const second = await submit(1, 1, 11);
    assert.notEqual(second, first);
    assert.equal(await respond(second, 11), 'Accepted');
    assert.equal(await scalar('select count(*)::int from group_adviser_applications where group_id=1'), 2);
}));
test('only the selected adviser may respond, including reject and null actor', () => fixture(async () => {
    const id = await submit();
    await fails(() => respond(id, 11), /Only the selected adviser/);
    await fails(() => respond(id, 11, false), /Only the selected adviser/);
    await fails(() => respond(id, null), /Only the selected adviser/);
    assert.equal(await scalar('select status from group_adviser_applications where application_id=$1', [id]), 'Pending');
}));
test('last slot: competing pending groups cannot both be accepted; failure is atomic and reject still works', () => fixture(async () => {
    const first = await submit();
    const second = await submit(2, 3);
    await respond(first);
    await fails(() => respond(second), /no remaining slots/);
    assert.equal(await scalar('select adviser_id from groups where group_id=2'), null);
    assert.equal(await scalar('select adviser_id from students where user_id=3'), null);
    assert.equal(await scalar('select status from group_adviser_applications where application_id=$1', [second]), 'Pending');
    assert.deepEqual(await slots(), { assigned_groups: 1, remaining_slots: 0 });
    assert.equal(await respond(second, 10, false), 'Rejected');
    await fails(() => submit(2, 3), /no remaining slots/);
}));
test('zero capacity and capacity reduction after submission are enforced', () => fixture(async () => {
    const id = await submit();
    await db.exec('update advisers set adviser_capacity=0 where user_id=10');
    await fails(() => submit(2, 3), /no remaining slots/);
    await fails(() => respond(id), /no remaining slots/);
    assert.equal(await respond(id, 10, false), 'Rejected');
}));
test('conflicting member assignment at acceptance rolls back the whole transaction', () => fixture(async () => {
    const id = await submit();
    await db.exec('update students set adviser_id=11 where user_id=2');
    await fails(() => respond(id), /another adviser/);
    assert.equal(await scalar('select adviser_id from students where user_id=1'), null);
    assert.equal(await scalar('select adviser_id from groups where group_id=1'), null);
    assert.deepEqual(await slots(), { assigned_groups: 0, remaining_slots: 1 });
}));
test('optional document metadata failure rolls back the pending application', () => fixture(async () => {
    await fails(() => scalar('select submit_group_adviser_application_with_document(1,1,10,$1::jsonb)', [JSON.stringify({file_name:'bad.pdf',storage_path:'test',file_type:'application/pdf',file_size:0})]), /check constraint/);
    assert.equal(await scalar('select count(*)::int from group_adviser_applications'), 0);
    assert.equal(await scalar('select count(*)::int from notifications'), 0);
    await scalar('select submit_group_adviser_application_with_document(1,1,10,$1::jsonb)', [JSON.stringify({file_name:'good.pdf',storage_path:'test',file_type:'application/pdf',file_size:100})]);
    assert.equal(await scalar('select count(*)::int from group_adviser_application_documents'), 1);
}));
test('admin additions inherit adviser and slot count survives membership changes and inactive students', () => fixture(async () => {
    await respond(await submit());
    await db.exec('insert into group_members(group_id,user_id) values(1,6); update users set is_active=false where user_id in(1,2,6); delete from group_members where user_id=2');
    assert.equal(await scalar('select adviser_id from students where user_id=6'), 10);
    assert.deepEqual(await slots(), { assigned_groups: 1, remaining_slots: 0 });
}));
test('anonymous and authenticated roles cannot execute actor-parameter RPCs or read private tables', () => fixture(async () => {
    for (const role of ['anon', 'authenticated']) {
        assert.equal(await scalar("select has_function_privilege($1, 'submit_group_adviser_application(bigint,bigint,bigint)', 'EXECUTE')", [role]), false);
        assert.equal(await scalar("select has_function_privilege($1, 'respond_to_group_adviser_application(bigint,bigint,boolean)', 'EXECUTE')", [role]), false);
        assert.equal(await scalar("select has_function_privilege($1, 'submit_group_adviser_application_with_document(bigint,bigint,bigint,jsonb)', 'EXECUTE')", [role]), false);
        assert.equal(await scalar("select has_table_privilege($1, 'group_adviser_applications', 'SELECT')", [role]), false);
        await db.exec(`SET LOCAL ROLE ${role}`);
        await fails(() => submit(), /permission denied/);
        await db.exec('RESET ROLE');
    }
}));
test('migration rerun preserves accepted history, assignments and user/group records', () => fixture(async () => {
    await respond(await submit());
    // Strip transaction boundaries so this rerun remains inside the test rollback.
    await db.exec(migration('015_separate_role_profiles.sql').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''));
    assert.equal(await scalar('select count(*)::int from users'), 11);
    assert.equal(await scalar('select count(*)::int from students'), 9);
    assert.equal(await scalar('select count(*)::int from advisers'), 2);
    assert.equal(await scalar('select count(*)::int from groups'), 3);
    assert.equal(await scalar("select count(*)::int from group_adviser_applications where status='Accepted'"), 1);
    assert.deepEqual(await slots(), { assigned_groups: 1, remaining_slots: 0 });
}));

test('separate student/adviser profiles retain accepted assignments and existing group membership', () => fixture(async () => {
    await db.exec("insert into group_adviser_applications(group_id,adviser_id,applicant_id,status) values(1,10,1,'Accepted'); update students set adviser_id=10 where user_id in(1,2); update groups set adviser_id=10 where group_id=1; update students set adviser_id=11 where user_id in(3,4); update groups set adviser_id=11 where group_id=2");
    assert.equal(await scalar('select adviser_id from groups where group_id=1'), 10);
    assert.equal(await scalar('select adviser_id from groups where group_id=2'), 11);
    assert.equal(await scalar('select adviser_id from students where user_id=4'), 11);
    assert.equal(await scalar('select count(*)::int from group_members'), 5);
    assert.equal(await scalar('select count(*)::int from users'), 11);
}));
test('group adviser application rejects members with conflicting profile assignments', () => fixture(async () => {
    await db.exec('update students set adviser_id=10 where user_id=1; update students set adviser_id=11 where user_id=2');
    await fails(() => submit(), /another adviser/);
    assert.equal(await scalar('select adviser_id from groups where group_id=1'), null);
    assert.equal(await scalar('select adviser_id from students where user_id=1'), 10);
    assert.equal(await scalar('select adviser_id from students where user_id=2'), 11);
}));
test('assigned members cannot be reassigned independently of their permanent group adviser', () => fixture(async () => {
    await respond(await submit());
    await fails(() => db.exec('update students set adviser_id=11 where user_id=1'), /permanent group adviser/);
    await fails(() => db.exec('update students set adviser_id=NULL where user_id=2'), /permanent group adviser/);
    assert.deepEqual(await slots(), { assigned_groups: 1, remaining_slots: 0 });
}));

test('HTTP submission and refresh persist status, selected-adviser inbox, accepted groups and remaining slots', () => fixture(async () => {
    const submitted = await request('/groups/1/adviser-applications', 1, { adviserId: 10, applicantId: 2 });
    assert.equal(submitted.status, 201);
    const id = submitted.body.application.ApplicationID;
    assert.equal((await request('/groups/1/adviser-application', 2)).body.application.Status, 'Pending');
    assert.equal((await request('/adviser/applications', 10)).body.length, 1);
    assert.equal((await request('/adviser/applications', 11)).body.length, 0);
    assert.equal((await request(`/adviser/applications/${id}/respond`, 10, { action: 'accept' })).status, 200);
    assert.equal((await request('/groups/1/adviser-application', 1)).body.application.Status, 'Accepted');
    assert.equal((await request('/adviser/applications', 10)).body.length, 0);
    const groups = await request('/adviser/groups', 10);
    assert.equal(groups.body[0].AdviserID, 10);
    assert.equal(groups.body[0].MemberCount, 2);
    const advisers = await request('/advisers', 1);
    assert.equal(advisers.body.find(a => a.UserID === 10).RemainingSlots, 0);
    assert.equal(advisers.body.find(a => a.UserID === 10).AssignedGroups, 1);
}));
test('HTTP role and ownership authorization cannot be bypassed using body IDs', () => fixture(async () => {
    assert.equal((await request('/groups/1/adviser-applications', 2, { adviserId: 10, applicantId: 1 })).status, 403);
    assert.equal((await request('/groups/1/adviser-applications', 10, { adviserId: 10 })).status, 403);
    assert.equal((await request('/groups/3/adviser-applications', 5, { adviserId: 10 })).status, 409);
    assert.equal((await request('/groups/1/adviser-application', 3)).status, 403);
    const id = (await request('/groups/1/adviser-applications', 1, { adviserId: 10 })).body.application.ApplicationID;
    assert.equal((await request(`/adviser/applications/${id}/respond`, 11, { action: 'accept', adviserId: 10 })).status, 403);
    assert.equal((await request(`/adviser/applications/${id}/respond`, 1, { action: 'accept' })).status, 403);
    assert.equal((await request(`/adviser/applications/${id}/respond`, 10, { action: 'other' })).status, 400);
    assert.equal((await request('/adviser/applications', 2)).status, 403);
}));
test('HTTP duplicate requests and competing accepts enforce uniqueness and capacity; rejection frees eligibility', () => fixture(async () => {
    const duplicates = await Promise.all([request('/groups/1/adviser-applications', 1, { adviserId: 10 }), request('/groups/1/adviser-applications', 1, { adviserId: 10 })]);
    assert.deepEqual(duplicates.map(r => r.status).sort(), [201, 409]);
    const first = duplicates.find(r => r.status === 201).body.application.ApplicationID;
    const second = (await request('/groups/2/adviser-applications', 3, { adviserId: 10 })).body.application.ApplicationID;
    const responses = await Promise.all([request(`/adviser/applications/${first}/respond`, 10, { action: 'accept' }), request(`/adviser/applications/${second}/respond`, 10, { action: 'accept' })]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const rejected = responses[0].status === 409 ? first : second;
    const leader = rejected === first ? 1 : 3;
    const group = rejected === first ? 1 : 2;
    assert.equal((await request(`/adviser/applications/${rejected}/respond`, 10, { action: 'reject' })).status, 200);
    assert.equal((await request(`/groups/${group}/adviser-applications`, leader, { adviserId: 11 })).status, 201);
    assert.deepEqual(await slots(), { assigned_groups: 1, remaining_slots: 0 });
}));

test('matching adviser/group courses ignore case and surrounding whitespace in SQL and API', () => fixture(async () => {
    await db.query('update advisers set course=$1 where user_id=10', [' \tbsit\r\n']);
    await db.query('update groups set course=$1 where group_id=1', [' \tbSiT\r\n']);
    const response = await request('/groups/1/adviser-applications', 1, { adviserId: 10 });
    assert.equal(response.status, 201);
    assert.equal((await request(`/adviser/applications/${response.body.application.ApplicationID}/respond`, 10, { action: 'accept' })).status, 200);
}));
test('different, blank, Unspecified and null adviser courses are rejected by SQL and direct API submission', () => fixture(async () => {
    for (const course of ['BSCS', '', ' \t ', ' UnSpEcIfIeD ']) {
        await db.query('update advisers set course=$1 where user_id=10', [course]);
        await fails(() => submit(), /adviser course must match/);
        const response = await request('/groups/1/adviser-applications', 1, { adviserId: 10, course: 'BSIT' });
        assert.equal(response.status, 409);
    }
    assert.equal(await scalar('select adviser_courses_match($1,$2)', ['BSIT', null]), false);
    assert.equal(await scalar('select count(*)::int from group_adviser_applications'), 0);
}));
test('course changes after submission block acceptance in SQL/API, preserve Pending and slots, and permit rejection', () => fixture(async () => {
    for (const course of ['BSCS', '', 'Unspecified']) {
        await db.exec("update advisers set course='BSIT' where user_id=10");
        const id = await submit();
        await db.query('update advisers set course=$1 where user_id=10', [course]);
        await fails(() => respond(id), /adviser course must match/);
        assert.equal((await request(`/adviser/applications/${id}/respond`, 10, { action: 'accept' })).status, 409);
        assert.equal(await scalar('select status from group_adviser_applications where application_id=$1', [id]), 'Pending');
        assert.deepEqual(await slots(), { assigned_groups: 0, remaining_slots: 1 });
        assert.equal((await request(`/adviser/applications/${id}/respond`, 10, { action: 'reject' })).status, 200);
    }
}));
test('008 preserves existing accepted assignments even when the adviser course differs', () => fixture(async () => {
    await respond(await submit());
    await db.exec("update advisers set course='BSCS' where user_id=10");
    await db.exec(migration('008_match_adviser_group_courses.sql').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''));
    await db.exec(migration('015_separate_role_profiles.sql').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''));
    assert.equal(await scalar('select adviser_id from groups where group_id=1'), 10);
    assert.equal(await scalar('select count(*)::int from students where user_id in (1,2) and adviser_id=10'), 2);
    assert.equal(await scalar("select count(*)::int from group_adviser_applications where status='Accepted'"), 1);
    assert.equal((await request('/adviser/groups', 10)).body.length, 1);
    assert.deepEqual(await slots(), { assigned_groups: 1, remaining_slots: 0 });
}));

test('a group course changed after submission is rechecked on SQL/API acceptance', () => fixture(async () => {
    const id = await submit();
    await db.exec("update groups set course='BSCS' where group_id=1");
    await fails(() => respond(id), /adviser course must match/);
    assert.equal((await request(`/adviser/applications/${id}/respond`, 10, { action: 'accept' })).status, 409);
    assert.equal(await scalar('select adviser_id from groups where group_id=1'), null);
    assert.equal(await scalar('select adviser_id from students where user_id=1'), null);
    assert.equal(await scalar('select status from group_adviser_applications where application_id=$1', [id]), 'Pending');
    assert.equal(await respond(id, 10, false), 'Rejected');
}));

const adviserAccount = { username: 'test.adviser', userCode: '202600001', role: 'adviser', firstName: 'Test', lastName: 'Adviser', password: 'StrongPass123!' };
test('admin-created BSCS adviser retains its selected course instead of defaulting to Unspecified', () => fixture(async () => {
    await db.exec("update users set role='admin' where user_id=9; select setval(pg_get_serial_sequence('users','user_id'),1000,true)");
    const response = await request('/admin/users', 9, { ...adviserAccount, course: ' bScS ' });
    assert.equal(response.status, 201);
    assert.equal(response.body.user.Course, 'BSCS');
    assert.equal(await scalar('select course from advisers where user_id=$1', [response.body.user.UserID]), 'BSCS');
}));
test('Library account endpoint creates an unexpired identity and librarian profile', () => fixture(async () => {
    await db.exec("update users set role='admin' where user_id=9");
    const response = await request('/admin/library-users', 9, { username: 'new.librarian', password: 'StrongPass123!' });
    assert.equal(response.status, 201);
    const userId = response.body.user.UserID;
    assert.equal(await scalar('select role from users where user_id=$1', [userId]), 'library');
    assert.equal(await scalar('select expires_at from users where user_id=$1', [userId]), null);
    assert.equal(await scalar('select count(*)::int from librarians where user_id=$1', [userId]), 1);
}));
test('admin can configure an existing Unspecified adviser as BSCS and the BSCS group can then apply', () => fixture(async () => {
    await db.exec("update users set role='admin' where user_id=9; update advisers set course='Unspecified' where user_id=10; update groups set course='BSCS' where group_id=1; update students set course='BSCS' where user_id in(1,2)");
    const response = await request('/admin/users/10', 9, { ...adviserAccount, password: '', course: 'bscs', adviserCapacity: 1 }, 'PATCH');
    assert.equal(response.status, 200);
    assert.equal(await scalar('select course from advisers where user_id=10'), 'BSCS');
    assert.equal((await request('/groups/1/adviser-applications', 1, { adviserId: 10 })).status, 201);
    assert.equal(await scalar('select count(*)::int from users'), 11);
}));
test('invalid adviser courses and unauthorized edits cannot change account configuration', () => fixture(async () => {
    await db.exec("update users set role='admin' where user_id=9");
    for (const course of ['', 'Unspecified', 'Unknown']) {
        assert.equal((await request('/admin/users', 9, { ...adviserAccount, course })).status, 400);
        assert.equal((await request('/admin/users/10', 9, { ...adviserAccount, password: '', course }, 'PATCH')).status, 400);
    }
    assert.equal((await request('/admin/users/10', 1, { ...adviserAccount, password: '', course: 'BSCS' }, 'PATCH')).status, 403);
    assert.equal(await scalar('select course from advisers where user_id=10'), 'BSIT');
}));

test('admin group deletion releases leader and members, returns the slot, and preserves unrelated students', () => fixture(async () => {
    await db.exec("update users set role='admin' where user_id=9; update students set adviser_id=11 where user_id=6");
    await respond(await submit());
    // Include an owner who is missing from membership rows.
    await db.exec('delete from group_members where user_id=1');
    assert.equal((await request('/admin/groups/1', 9, undefined, 'DELETE')).status, 200);
    assert.equal(await scalar('select count(*)::int from groups where group_id=1'), 0);
    assert.equal(await scalar('select count(*)::int from group_members where group_id=1'), 0);
    assert.equal(await scalar('select count(*)::int from group_adviser_applications where group_id=1'), 0);
    assert.equal(await scalar('select count(*)::int from students where user_id in(1,2) and adviser_id is null'), 2);
    assert.equal(await scalar('select adviser_id from students where user_id=6'), 11);
    assert.equal(await scalar('select count(*)::int from users'), 11);
    assert.deepEqual(await slots(), { assigned_groups: 0, remaining_slots: 1 });
}));
test('deleting a legacy group clears old member adviser links so a new group can apply to another adviser', () => fixture(async () => {
    await db.exec("update users set role='admin' where user_id=9; update students set adviser_id=11 where user_id in(1,2)");
    assert.equal((await request('/admin/groups/1', 9, undefined, 'DELETE')).status, 200);
    await db.exec("insert into groups(group_id,group_name,course,owner_id,finalized_at) values(4,'New group','BSIT',1,now()); insert into group_members(group_id,user_id) values(4,1),(4,2)");
    const response = await request('/groups/4/adviser-applications', 1, { adviserId: 10 });
    assert.equal(response.status, 201);
    assert.equal((await request(`/adviser/applications/${response.body.application.ApplicationID}/respond`, 10, { action: 'accept' })).status, 200);
}));
test('group deletion is authorized and validates missing/invalid groups without changing student assignments', () => fixture(async () => {
    await db.exec("update users set role='admin' where user_id=9; update students set adviser_id=10 where user_id=1");
    assert.equal((await request('/admin/groups/1', 1, undefined, 'DELETE')).status, 403);
    await fails(() => scalar('select admin_delete_group(1,1)'), /Admin access is required/);
    assert.equal((await request('/admin/groups/nope', 9, undefined, 'DELETE')).status, 400);
    assert.equal((await request('/admin/groups/999', 9, undefined, 'DELETE')).status, 404);
    assert.equal(await scalar('select adviser_id from students where user_id=1'), 10);
    for (const role of ['anon', 'authenticated']) assert.equal(await scalar("select has_function_privilege($1, 'admin_delete_group(bigint,bigint)', 'EXECUTE')", [role]), false);
}));

const fileMetadata = (count, size = 10) => Array.from({ length: count }, (_, index) => ({ file_name: `file-${index}.pdf`, storage_path: `test/${index}`, file_type: 'application/pdf', file_size: size }));
const submitFiles = files => scalar('select submit_group_adviser_application_with_documents(1,1,10,$1::jsonb)', [JSON.stringify(files)]);
const pdfUpload = (name, size = 20) => {
    const bytes = Buffer.alloc(size, 32); bytes.write('%PDF-1.4\n');
    return { fileName: name, mimeType: 'application/pdf', data: bytes.toString('base64') };
};

test('SQL supports five files totaling exactly 10 MB and preserves them on migration rerun', () => fixture(async () => {
    const id = await submitFiles(fileMetadata(5, 2 * 1024 * 1024));
    assert.equal(await scalar('select count(*)::int from group_adviser_application_documents where application_id=$1', [id]), 5);
    await db.exec(migration('010_application_multiple_files.sql').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''));
    assert.equal(await scalar('select count(*)::int from group_adviser_application_documents'), 5);
}));
test('SQL enforces file count and combined size on RPCs and direct document writes', () => fixture(async () => {
    await fails(() => submitFiles(fileMetadata(6)), /1 to 5 files/);
    await fails(() => submitFiles(fileMetadata(2, 6 * 1024 * 1024)), /10 MB/);
    assert.equal(await scalar('select count(*)::int from group_adviser_applications'), 0);
    const id = await submitFiles(fileMetadata(5));
    await fails(() => db.query("insert into group_adviser_application_documents(application_id,group_id,adviser_id,uploaded_by,file_name,storage_path,file_type,file_size) values($1,1,10,1,'extra.pdf','extra','application/pdf',10)", [id]), /at most 5 files/);
    await fails(() => db.query('update group_adviser_application_documents set file_size=10485760 where application_id=$1', [id]), /10 MB/);
    await fails(() => db.query('update group_adviser_application_documents set adviser_id=11 where application_id=$1', [id]), /ownership/);
}));
test('HTTP persists every uploaded file, lists them after refresh, and provides adviser-only inline previews', () => fixture(async () => {
    const requirements = Array.from({ length: 5 }, (_, i) => pdfUpload(`requirements-${i}.pdf`));
    const saved = await request('/groups/1/adviser-applications', 1, { adviserId: 10, requirements });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.application.Requirements.length, 5);
    assert.equal(storage.files.size, 5);
    const inbox = await request('/adviser/applications', 10);
    assert.equal(inbox.body[0].Requirements.length, 5);
    assert.equal(inbox.body[0].Requirement.DocumentID, inbox.body[0].Requirements[0].DocumentID);
    const doc = inbox.body[0].Requirements[4];
    const url = `/adviser/applications/${saved.body.application.ApplicationID}/requirements/${doc.DocumentID}`;
    const preview = await request(url, 10);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.url.includes('download='), false);
    assert.equal(preview.body.downloadUrl.includes('download='), true);
    assert.equal((await request(url, 11)).status, 403);
    assert.equal((await request(url, 1)).status, 403);
    assert.equal((await request(url.replace('/requirements/', '/requirements/999'), 10)).status, 404);
}));
test('HTTP accepts exactly 10 MB combined and rejects excess bytes or a sixth file before Storage uploads', () => fixture(async () => {
    const requirements = [pdfUpload('first.pdf', 5 * 1024 * 1024), pdfUpload('second.pdf', 5 * 1024 * 1024)];
    assert.equal((await request('/groups/1/adviser-applications', 1, { adviserId: 10, requirements })).status, 201);
    const uploads = storage.uploads;
    assert.equal((await request('/groups/2/adviser-applications', 3, { adviserId: 10, requirements: [...requirements, pdfUpload('extra.pdf')] })).status, 413);
    assert.equal((await request('/groups/2/adviser-applications', 3, { adviserId: 10, requirements: Array.from({ length: 6 }, () => pdfUpload('file.pdf')) })).status, 400);
    assert.equal(storage.uploads, uploads);
}));
test('upload failure and rejected submission remove staged files without leaving a partial application', () => fixture(async () => {
    storage.failAt = 2;
    assert.equal((await request('/groups/1/adviser-applications', 1, { adviserId: 10, requirements: [pdfUpload('first.pdf'), pdfUpload('second.pdf')] })).status, 502);
    assert.equal(storage.files.size, 0);
    assert.equal(await scalar('select count(*)::int from group_adviser_applications'), 0);
    storage.failAt = 0;
    assert.equal((await request('/groups/1/adviser-applications', 2, { adviserId: 10, requirements: [pdfUpload('unauthorized.pdf')] })).status, 403);
    assert.equal(storage.files.size, 0);
    const saved = await request('/groups/1/adviser-applications', 1, { adviserId: 10, requirement: pdfUpload('legacy.pdf') });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.application.Requirements.length, 1);
}));

function wordFixture() {
    // A minimal real DOCX archive, stored without compression.
    const entries = [
        ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
        ['word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Private application document preview.</w:t></w:r></w:p></w:body></w:document>'],
    ];
    const locals = [], centrals = [];
    let offset = 0;
    for (const [name, value] of entries) {
        const filename = Buffer.from(name), bytes = Buffer.from(value);
        let crc = -1;
        for (const byte of bytes) { crc ^= byte; for (let bit=0; bit<8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
        crc = (crc ^ -1) >>> 0;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt32LE(crc,14);
        local.writeUInt32LE(bytes.length,18); local.writeUInt32LE(bytes.length,22); local.writeUInt16LE(filename.length,26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt32LE(crc,16);
        central.writeUInt32LE(bytes.length,20); central.writeUInt32LE(bytes.length,24); central.writeUInt16LE(filename.length,28); central.writeUInt32LE(offset,42);
        locals.push(local, filename, bytes); centrals.push(central, filename); offset += local.length + filename.length + bytes.length;
    }
    const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
    return Buffer.concat([...locals, directory, end]);
}
test('Word application files have private text previews, and corrupt documents retain a download fallback', () => fixture(async () => {
    const requirements = [{ fileName: 'requirements.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: wordFixture().toString('base64') }];
    const saved = await request('/groups/1/adviser-applications', 1, { adviserId: 10, requirements });
    assert.equal(saved.status, 201);
    const doc = saved.body.application.Requirements[0];
    const url = `/adviser/applications/${saved.body.application.ApplicationID}/requirements/${doc.DocumentID}?preview=text`;
    const preview = await request(url, 10);
    assert.equal(preview.status, 200);
    assert.match(preview.body.text, /Private application document preview/);
    assert.equal(preview.body.previewError, undefined);
    assert.equal((await request(url, 11)).status, 403);
    const key = [...storage.files.keys()][0]; storage.files.get(key).buffer = Buffer.from('corrupt');
    const fallback = await request(url, 10);
    assert.equal(fallback.status, 200);
    assert.match(fallback.body.previewError, /Download/);
    assert.ok(fallback.body.downloadUrl);
}));

test('invalid or empty files and mixed upload payloads fail before any Storage writes', () => fixture(async () => {
    for (const body of [
        { requirements: [null] }, { requirements: null },
        { requirements: [{ ...pdfUpload('bad.exe'), mimeType: 'application/octet-stream' }] },
        { requirements: [{ ...pdfUpload('empty.pdf'), data: '' }] },
        { requirements: [{ ...pdfUpload('bad.pdf'), data: '!!!!' }] },
        { requirements: [], requirement: pdfUpload('mixed.pdf') },
    ]) assert.equal((await request('/groups/1/adviser-applications', 1, { adviserId: 10, ...body })).status, 400);
    assert.equal((await request('/groups/1/adviser-applications', 1, { adviserId: 10, requirements: [{ ...pdfUpload('fake.pdf'), data: Buffer.from('not a PDF').toString('base64') }] })).status, 415);
    assert.equal(storage.uploads, 0);
    for (const role of ['anon', 'authenticated']) assert.equal(await scalar("select has_function_privilege($1, 'submit_group_adviser_application_with_documents(bigint,bigint,bigint,jsonb)', 'EXECUTE')", [role]), false);
}));

const overdueApplication = async (group = 1, applicant = 1, adviser = 10, interval = '24 hours') => scalar(
    "insert into group_adviser_applications(group_id,applicant_id,adviser_id,created_at) values($1,$2,$3,clock_timestamp()-$4::interval) returning application_id", [group, applicant, adviser, interval]);

test('submission notifies only the selected adviser once with actual group and upload metadata', () => fixture(async () => {
    const saved = await request('/groups/1/adviser-applications', 1, { adviserId: 10, requirements: [pdfUpload('proposal.pdf'), pdfUpload('appendix.pdf'), pdfUpload('references.pdf')] });
    assert.equal(saved.status, 201);
    const id = saved.body.application.ApplicationID;
    const inbox = (await request('/notifications', 10)).body;
    assert.equal(inbox.items.length, 1); assert.equal(inbox.unreadCount, 1);
    const notification = inbox.items[0];
    assert.equal(notification.notification_type, 'adviser_application_submitted');
    assert.equal(notification.application_id, id);
    assert.equal(notification.application.GroupName, 'First');
    assert.equal(notification.application.Course, 'BSIT');
    assert.equal(notification.application.MemberCount, 2);
    assert.equal(notification.application.FileCount, 3);
    assert.equal(notification.application.FirstFileName, 'proposal.pdf');
    assert.equal(notification.application.Requirements, undefined); // summary only
    assert.equal(notification.application.CanAccept, true);
    assert.equal(notification.application.ExpiresAt, saved.body.application.ExpiresAt);
    assert.deepEqual((await request('/notifications', 11)).body.items, []);
    assert.deepEqual((await request('/notifications', 1)).body.items, []);
    assert.equal((await request('/groups/1/adviser-applications', 1, { adviserId: 10 })).status, 409);
    assert.equal((await request('/notifications', 10)).body.items.length, 1);
    assert.equal((await request('/notifications', 10)).body.items.length, 1);
}));

test('adviser details confirm zero, one and multiple application files and enforce ownership', () => fixture(async () => {
    for (const count of [0, 1, 3]) {
        const saved = await request('/groups/1/adviser-applications', 1, { adviserId: 10, requirements: Array.from({ length: count }, (_, i) => pdfUpload(`document-${i}.pdf`)) });
        assert.equal(saved.status, 201);
        const id = saved.body.application.ApplicationID;
        const detail = await request(`/adviser/applications/${id}`, 10);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.application.FileCount, count);
        assert.equal(detail.body.application.Requirements.length, count);
        assert.equal(detail.body.application.FirstFileName, count ? 'document-0.pdf' : null);
        assert.equal((await request(`/adviser/applications/${id}`, 11)).status, 403);
        assert.equal((await request(`/adviser/applications/${id}`, 1)).status, 403);
        await respond(id, 10, false);
        assert.equal((await request(`/adviser/applications/${id}`, 10)).body.application.CanAccept, false);
    }
    for (const role of ['anon', 'authenticated']) {
        assert.equal(await scalar("select has_function_privilege($1,'get_adviser_application_review(bigint,bigint)','EXECUTE')", [role]), false);
        assert.equal(await scalar("select has_function_privilege($1,'adviser_application_review_json(bigint,bigint)','EXECUTE')", [role]), false);
    }
}));

test('adviser notification actions recheck ownership, course, slots, status and expiration', () => fixture(async () => {
    const id = await submit();
    assert.equal((await request(`/adviser/applications/${id}/respond`, 11, { action: 'accept' })).status, 403);
    await db.exec("update advisers set course='BSCS' where user_id=10");
    assert.equal((await request('/notifications', 10)).body.items[0].application.CanAccept, false);
    assert.equal((await request(`/adviser/applications/${id}/respond`, 10, { action: 'accept' })).status, 409);
    await db.exec("update advisers set course='BSIT', adviser_capacity=0 where user_id=10");
    assert.equal((await request('/notifications', 10)).body.items[0].application.CanAccept, false);
    assert.equal((await request(`/adviser/applications/${id}/respond`, 10, { action: 'accept' })).status, 409);
    await db.exec('update advisers set adviser_capacity=1 where user_id=10');
    assert.equal((await request(`/adviser/applications/${id}/respond`, 10, { action: 'accept' })).status, 200);
    const accepted = (await request('/notifications', 10)).body.items[0].application;
    assert.equal(accepted.Status, 'Accepted'); assert.equal(accepted.CanAccept, false);
    assert.equal((await request(`/adviser/applications/${id}/respond`, 10, { action: 'accept' })).status, 409);
    assert.equal((await request('/notifications', 1)).body.items.length, 1);
    const expired = await overdueApplication(2, 3, 11);
    const expiredDetail = await request(`/adviser/applications/${expired}`, 11);
    assert.equal(expiredDetail.body.application.Status, 'Expired');
    assert.equal(expiredDetail.body.application.CanAccept, false);
    assert.equal((await request(`/adviser/applications/${expired}/respond`, 11, { action: 'accept' })).status, 409);
    assert.equal((await request('/notifications', 3)).body.items[0].notification_type, 'adviser_application_expired');
}));

test('missing application upload metadata fails lookup instead of reporting zero files', () => fixture(async () => {
    await submit();
    await db.exec('alter table group_adviser_application_documents rename to unavailable_document_metadata');
    const response = await request('/adviser/applications', 10);
    assert.equal(response.status, 503);
    assert.equal(response.body.Requirements, undefined);
    const inbox = await request('/notifications', 10);
    assert.equal(inbox.status, 503);
    assert.equal(inbox.body.items, undefined);
}));

test('015 profile migration rerun preserves existing applications and notifications', () => fixture(async () => {
    const id = await submit();
    await respond(id);
    const before = (await db.query('select notification_id,application_id,recipient_id,created_at from notifications where application_id=$1', [id])).rows;
    await db.exec(migration('015_separate_role_profiles.sql').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''));
    const after = (await db.query('select notification_id,application_id,recipient_id,created_at from notifications where application_id=$1', [id])).rows;
    assert.deepEqual(after, before);
    assert.equal(await scalar("select count(*)::int from group_adviser_applications where status='Accepted'"), 1);
    assert.equal(await scalar('select count(*)::int from users'), 11);
    assert.equal(await scalar('select count(*)::int from groups'), 3);
}));
test('acceptance notifies only the applicant with actual names and deduplicates the event', () => fixture(async () => {
    const id = await submit();
    assert.equal(await respond(id), 'Accepted');
    const events = (await db.query('select * from notifications where application_id=$1 and recipient_id=1', [id])).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].recipient_id, 1);
    assert.equal(events[0].notification_type, 'adviser_application_accepted');
    assert.match(events[0].message, /User 10 accepted your application for First/);
    assert.equal(events[0].read_at, null);
    await fails(() => respond(id), /already been processed/);
    await db.query("update group_adviser_applications set status='Accepted' where application_id=$1", [id]);
    assert.equal(await scalar('select count(*)::int from notifications where recipient_id < 10'), 1);
    await fails(() => db.query("insert into notifications(recipient_id,notification_type,title,message,event_key) select recipient_id,notification_type,title,message,event_key from notifications where application_id=$1", [id]), /unique constraint/);
    assert.deepEqual((await request('/notifications', 2)).body.items, []);
}));
test('rejection sends no notification and terminal accepted/rejected rows never expire', () => fixture(async () => {
    await respond(await submit(), 10, false);
    await db.exec("insert into group_adviser_applications(group_id,applicant_id,adviser_id,status,created_at) values(2,3,10,'Accepted',clock_timestamp()-interval '3 days')");
    await scalar('select expire_group_adviser_applications()');
    assert.equal(await scalar('select count(*)::int from notifications where recipient_id < 10'), 0);
    assert.equal(await scalar("select count(*)::int from group_adviser_applications where status='Rejected'"), 1);
    assert.equal(await scalar("select count(*)::int from group_adviser_applications where status='Accepted'"), 1);
}));
test('expiration uses the exact 24-hour database deadline, notifies once and allows a fresh application', () => fixture(async () => {
    const id = await overdueApplication();
    assert.equal(await scalar('select extract(epoch from (expires_at-created_at))::int from group_adviser_applications where application_id=$1', [id]), 86400);
    assert.equal(await scalar('select expire_group_adviser_applications()'), 1);
    assert.equal(await scalar('select expire_group_adviser_applications()'), 0);
    assert.equal(await scalar('select status from group_adviser_applications where application_id=$1', [id]), 'Expired');
    assert.equal(await scalar('select responded_at=expires_at from group_adviser_applications where application_id=$1', [id]), true);
    assert.equal(await scalar('select count(*)::int from notifications where application_id=$1 and recipient_id=1', [id]), 1);
    assert.equal(await respond(id), 'Expired');
    assert.deepEqual(await slots(), { assigned_groups: 0, remaining_slots: 1 });
    const next = await submit();
    assert.notEqual(next, id);
    assert.equal(await scalar('select status from group_adviser_applications where application_id=$1', [next]), 'Pending');
}));
test('an application before its deadline stays Pending; its timestamps cannot be extended', () => fixture(async () => {
    const id = await overdueApplication(1, 1, 10, '23 hours 59 minutes');
    assert.equal(await scalar('select expire_group_adviser_applications()'), 0);
    await fails(() => db.query("update group_adviser_applications set expires_at=expires_at+interval '1 hour' where application_id=$1", [id]), /timestamps cannot be changed/);
    assert.equal(await scalar('select status from group_adviser_applications where application_id=$1', [id]), 'Pending');
}));
test('server reads expire overdue applications, expose deadlines and preserve rejection/expiration status', () => fixture(async () => {
    const id = await overdueApplication();
    const status = await request('/groups/1/adviser-application', 1);
    assert.equal(status.body.application.Status, 'Expired');
    assert.ok(status.body.application.ExpiresAt);
    assert.ok(status.body.application.ServerNow);
    assert.equal((await request(`/adviser/applications/${id}/respond`, 10, { action: 'accept' })).status, 409);
    assert.deepEqual((await request('/adviser/applications', 10)).body, []);
    assert.equal((await request(`/adviser-applications/${id}`, 2)).status, 403);
    assert.equal((await request(`/adviser-applications/${id}`, 1)).body.application.Status, 'Expired');
    const fresh = (await request('/groups/1/adviser-applications', 1, { adviserId: 10 })).body.application;
    assert.equal(fresh.Status, 'Pending'); assert.ok(fresh.ExpiresAt); assert.ok(fresh.ServerNow);
    assert.equal((await request(`/adviser/applications/${fresh.ApplicationID}/respond`, 10, { action: 'reject' })).status, 200);
    assert.equal((await request('/groups/1/adviser-application', 1)).body.application.Status, 'Rejected');
    assert.equal(await scalar('select count(*)::int from notifications where recipient_id < 10'), 1); // applicant expiry only
}));
test('notification ownership and read status are enforced and persisted despite spoofed recipient fields', () => fixture(async () => {
    await respond(await submit());
    const inbox = await request('/notifications?recipient_id=2', 1);
    assert.equal(inbox.body.unreadCount, 1);
    const id = inbox.body.items[0].notification_id;
    assert.equal((await request(`/notifications/${id}/read`, 2, { recipient_id: 1 }, 'PATCH')).status, 404);
    await request('/notifications/read-all', 2, { recipient_id: 1 }, 'PATCH');
    assert.equal((await request('/notifications', 1)).body.unreadCount, 1);
    const read = await request(`/notifications/${id}/read`, 1, { recipient_id: 2, read_at: '2000-01-01' }, 'PATCH');
    assert.equal(read.status, 200); assert.equal(read.body.unreadCount, 0);
    const refreshed = (await request('/notifications', 1)).body;
    assert.equal(refreshed.items[0].read_at, read.body.readAt);
    const repeated = await request(`/notifications/${id}/read`, 1, undefined, 'PATCH');
    assert.equal(repeated.body.readAt, read.body.readAt);
    for (const role of ['anon', 'authenticated']) {
        assert.equal(await scalar("select has_table_privilege($1,'notifications','SELECT')", [role]), false);
        assert.equal(await scalar("select has_function_privilege($1,'mark_user_notification_read(bigint,bigint)','EXECUTE')", [role]), false);
        assert.equal(await scalar("select has_function_privilege($1,'get_user_notifications(bigint,bigint)','EXECUTE')", [role]), false);
    }
}));
test('notification pagination keeps an exact unread count and mark-all changes only the current recipient', () => fixture(async () => {
    await db.exec("insert into notifications(recipient_id,notification_type,title,message,event_key) select 1,'adviser_application_expired','Expired','Test event','page-'||n from generate_series(1,25)n; insert into notifications(recipient_id,notification_type,title,message,event_key) values(2,'adviser_application_expired','Expired','Other event','other')");
    const first = (await request('/notifications', 1)).body;
    assert.equal(first.items.length, 20); assert.equal(first.unreadCount, 25); assert.equal(first.hasMore, true);
    const last = (await request(`/notifications?before=${first.nextCursor}`, 1)).body;
    assert.equal(last.items.length, 5); assert.equal(last.hasMore, false);
    const allRead = await request('/notifications/read-all', 1, {}, 'PATCH');
    assert.equal(allRead.body.unreadCount, 0);
    assert.ok((await request('/notifications', 1)).body.items.every(item => item.read_at));
    assert.equal((await request('/notifications', 2)).body.unreadCount, 1);
}));
test('acceptance notification rolls back if a later member assignment fails', () => fixture(async () => {
    const id = await submit();
    await db.exec("create function public.test_fail_assignment() returns trigger language plpgsql as $$ begin if NEW.adviser_id is not null then raise exception 'test assignment rollback'; end if; return NEW; end $$; create trigger test_fail_assignment before update of adviser_id on students for each row execute function public.test_fail_assignment()");
    await fails(() => respond(id), /test assignment rollback/);
    assert.equal(await scalar('select count(*)::int from notifications where recipient_id < 10'), 0);
    assert.equal(await scalar('select status from group_adviser_applications where application_id=$1', [id]), 'Pending');
    assert.equal(await scalar('select adviser_id from groups where group_id=1'), null);
}));
test('migration backfills original deadlines, expires old Pending rows once and preserves existing accepted assignments', () => fixture(async () => {
    // Simulate upgrading from 010, before submission notifications existed.
    await db.exec('drop trigger notify_adviser_application_submission on group_adviser_applications');
    const first = await submit(); const second = await submit(2, 3);
    await db.exec('drop trigger guard_adviser_application_deadline on group_adviser_applications; alter table group_adviser_applications alter column expires_at drop not null');
    await db.query("update group_adviser_applications set created_at=clock_timestamp()-interval '25 hours',expires_at=null where application_id=$1", [first]);
    await db.query("update group_adviser_applications set created_at=clock_timestamp()-interval '12 hours',expires_at=null where application_id=$1", [second]);
    await db.exec("update students set adviser_id=11 where user_id=5; update groups set adviser_id=11,finalized_at=clock_timestamp() where group_id=3; insert into group_adviser_applications(group_id,applicant_id,adviser_id,status,created_at) values(3,5,11,'Accepted',clock_timestamp()-interval '3 days')");
    const oldCreated = await scalar('select created_at::text from group_adviser_applications where application_id=$1', [first]);
    const sql = migration('011_notifications_and_application_expiry.sql').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
    await db.exec(sql); await db.exec(sql);
    assert.equal(await scalar('select created_at::text from group_adviser_applications where application_id=$1', [first]), oldCreated);
    assert.equal(await scalar('select count(*)::int from group_adviser_applications where expires_at=created_at+interval\'24 hours\''), 3);
    assert.equal(await scalar('select status from group_adviser_applications where application_id=$1', [first]), 'Expired');
    assert.equal(await scalar('select status from group_adviser_applications where application_id=$1', [second]), 'Pending');
    assert.equal(await scalar('select count(*)::int from notifications where recipient_id < 10'), 1);
    assert.equal(await scalar('select adviser_id from groups where group_id=3'), 11);
    assert.equal(await scalar('select adviser_id from students where user_id=5'), 11);
    assert.equal(await scalar('select count(*)::int from users'), 11);
}));


test('complete two-account HTTP workflow keeps attachments, acceptance outcome and read state after refresh', () => fixture(async () => {
    const saved = await request('/groups/1/adviser-applications', 1, { adviserId: 10, requirements: [pdfUpload('proposal.pdf'), pdfUpload('appendix.pdf'), pdfUpload('references.pdf')] });
    assert.equal(saved.status, 201);
    const id = saved.body.application.ApplicationID;
    const adviserInbox = (await request('/notifications', 10)).body;
    assert.equal(adviserInbox.unreadCount, 1);
    assert.equal(adviserInbox.items[0].application.FileCount, 3);
    const details = (await request('/adviser/applications/' + id, 10)).body.application;
    assert.equal(details.Requirements.length, 3);
    for (const file of details.Requirements) {
        assert.equal((await request('/adviser/applications/' + id + '/requirements/' + file.DocumentID, 10)).status, 200);
        assert.equal((await request('/adviser/applications/' + id + '/requirements/' + file.DocumentID, 11)).status, 403);
    }
    await request('/notifications/' + adviserInbox.items[0].notification_id + '/read', 10, {}, 'PATCH');
    assert.equal((await request('/adviser/applications/' + id, 10)).body.application.Requirements.length, 3);
    assert.equal((await request('/adviser/applications/' + id + '/respond', 10, { action: 'accept' })).status, 200);
    assert.deepEqual(await slots(), { assigned_groups: 1, remaining_slots: 0 });
    assert.equal((await request('/adviser/groups', 10)).body.length, 1);
    const studentInbox = (await request('/notifications', 1)).body;
    assert.equal(studentInbox.unreadCount, 1);
    assert.equal(studentInbox.items[0].outcome.GroupName, 'First');
    assert.equal(studentInbox.items[0].outcome.AdviserName, 'User 10');
    assert.equal(studentInbox.items[0].outcome.Status, 'Accepted');
    assert.ok(studentInbox.items[0].outcome.RespondedAt);
    assert.equal(studentInbox.items[0].application_id, id);
    await request('/notifications/read-all', 1, {}, 'PATCH');
    const refreshed = (await request('/notifications', 1)).body;
    assert.equal(refreshed.unreadCount, 0);
    assert.ok(refreshed.items[0].read_at);
    const history = (await request('/notifications', 10)).body.items[0];
    assert.ok(history.read_at);
    assert.equal(history.application.Status, 'Accepted');
    assert.equal(history.application.CanAccept, false);
    assert.equal(history.application.FileCount, 3);
    assert.deepEqual((await request('/notifications', 2)).body.items, []);
}));

test('013 enriches existing outcomes idempotently without modifying events or exposing another applicant', () => fixture(async () => {
    const id = await submit(); await respond(id);
    const before = await db.query('select * from notifications order by notification_id');
    const sql = migration('013_notification_application_outcomes.sql').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
    await db.exec(sql); await db.exec(sql);
    assert.deepEqual((await db.query('select * from notifications order by notification_id')).rows, before.rows);
    assert.equal((await request('/notifications', 1)).body.items[0].outcome.ApplicationID, id);
    await db.query("insert into notifications(recipient_id,notification_type,title,message,application_id,event_key) values(2,'adviser_application_accepted','Unexpected reference','Private', $1, 'scope-test')", [id]);
    assert.equal((await request('/notifications', 2)).body.items[0].outcome, null);
}));


// Opt-in browser integration against the actual Express routes and migrated SQL.
// Only Supabase's network transport/Storage is substituted by the isolated fixture.
// Start Vite, then set WORKFLOW_BROWSER_URL=http://127.0.0.1:5178 to run it.
test('two browser accounts complete submission, bell VIEW, acceptance, polling and refresh against real API/SQL', { skip: !process.env.WORKFLOW_BROWSER_URL }, () => fixture(async () => {
    const { chromium, expect } = require('@playwright/test');
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
        const contexts = [];
        for (const [id, role] of [[1, 'student'], [10, 'adviser']]) {
            const context = await browser.newContext(); contexts.push(context);
            await context.addInitScript(user => sessionStorage.setItem('jf_user', JSON.stringify(user)), { id: String(id), role, name: 'User ' + id, sessionToken: token(id) });
            await context.route('**/api/**', async route => {
                const url = new URL(route.request().url());
                const response = await route.fetch({ url: origin + url.pathname.replace(/^\/api/, '') + url.search });
                await route.fulfill({ response });
            });
        }
        const student = await contexts[0].newPage(), adviser = await contexts[1].newPage();
        const base = process.env.WORKFLOW_BROWSER_URL;
        await contexts[1].route('https://storage.test/**', async route => {
            const key = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
            const file = storage.files.get(key);
            assert.ok(file);
            await route.fulfill({ body: file.buffer, contentType: 'application/pdf', headers: { 'Access-Control-Allow-Origin': '*' } });
        });
        const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 480] /Resources << >> /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream'];
        let pdf = '%PDF-1.4\n'; const offsets = [0];
        for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += (i + 1) + ' 0 obj\n' + object + '\nendobj\n'; }
        const xref = Buffer.byteLength(pdf);
        pdf += 'xref\n0 5\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10,'0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
        await adviser.goto(base + '/group');
        await adviser.getByRole('button', { name: 'Notifications', exact: true }).click();
        await expect(adviser.getByText('You have no notifications yet.')).toBeVisible();
        await student.goto(base + '/adviser');
        await student.locator('.adviser-table tbody tr').filter({ hasText: 'User 10' }).getByRole('button', { name: 'Apply', exact: true }).click();
        await student.locator('#adviser-requirement-file').setInputFiles(['proposal.pdf','appendix.pdf','references.pdf'].map(name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(pdf) })));
        await student.getByRole('button', { name: 'Confirm Application' }).click();
        await expect(student.getByText(/Adviser application: Pending/)).toBeVisible();
        const bell = adviser.getByRole('dialog', { name: 'Notifications', exact: true });
        await expect(bell.getByText('proposal.pdf + 2 other files', { exact: false })).toBeVisible({ timeout: 15000 });
        await bell.getByRole('button', { name: 'View', exact: true }).click();
        const details = adviser.getByRole('dialog', { name: 'Application details', exact: true });
        await expect(details.locator('.application-file-row')).toHaveCount(3);
        await details.getByRole('button', { name: 'View proposal.pdf', exact: true }).click();
        await expect(adviser.getByRole('img', { name: 'proposal.pdf, page 1', exact: true })).toBeVisible();
        await expect(adviser.getByRole('link', { name: 'Download original' })).toHaveAttribute('href', /download=proposal.pdf/);
        await adviser.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }).last().click();
        await details.getByRole('button', { name: 'Close', exact: true }).last().click();
        await adviser.getByRole('button', { name: 'Notifications', exact: true }).click();
        // A previously read notification must still open the same files.
        await bell.getByRole('button', { name: 'View', exact: true }).click();
        await expect(details.locator('.application-file-row')).toHaveCount(3);
        await student.getByRole('button', { name: 'Notifications', exact: true }).click();
        await details.getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(details.getByRole('button', { name: 'Accepted', exact: true })).toBeDisabled();
        const studentBell = student.getByRole('dialog', { name: 'Notifications', exact: true });
        await expect(studentBell.getByText('Status: Accepted', { exact: true })).toBeVisible({ timeout: 15000 });
        await expect(studentBell.getByText('Adviser: User 10', { exact: true })).toBeVisible();
        await expect(studentBell.getByText('First', { exact: true })).toBeVisible();
        await studentBell.getByRole('button', { name: 'View', exact: true }).click();
        await expect(student.getByRole('region', { name: 'Selected application' })).toContainText('Accepted');
        await student.reload();
        await student.getByRole('button', { name: 'Notifications', exact: true }).click();
        await expect(studentBell.getByRole('img', { name: 'Read notification', exact: true })).toBeVisible();
        await details.getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect(adviser.locator('.adviser-group-summary tbody')).toContainText('First');
        await adviser.goto(base + '/');
        await expect(adviser.locator('.admin-stat').filter({ hasText: 'Available Slots' }).locator('span')).toHaveText('0');
        assert.deepEqual(await slots(), { assigned_groups: 1, remaining_slots: 0 });
        assert.equal(storage.files.size, 3);
        assert.equal(await scalar("select count(*)::int from notifications where notification_type='adviser_application_accepted'"), 1);
    } finally { await browser.close(); }
}));


test('failed follow-up metadata lookup preserves the committed upload without claiming zero files', () => fixture(async () => {
    storage.metadataLookupFails = true;
    const saved = await request('/groups/1/adviser-applications', 1, { adviserId: 10, requirements: [pdfUpload('proposal.pdf')] });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.application.Requirements, undefined);
    assert.equal(saved.body.application.Requirement, undefined);
    storage.metadataLookupFails = false;
    const details = await request('/adviser/applications/' + saved.body.application.ApplicationID, 10);
    assert.equal(details.body.application.FileCount, 1);
    assert.equal(details.body.application.Requirements[0].FileName, 'proposal.pdf');
    assert.equal(storage.files.size, 1);
}));

test('a temporary expiry-maintenance failure does not hide persisted notifications', () => fixture(async () => {
    await submit();
    storage.expiryFails = true;
    const inbox = await request('/notifications', 10);
    assert.equal(inbox.status, 200);
    assert.equal(inbox.body.items.length, 1);
    assert.equal(inbox.body.unreadCount, 1);
}));
