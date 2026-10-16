// Real multi-session PostgreSQL tests. This starts a disposable localhost-only
// cluster in a verified temporary directory; it never reads Supabase credentials.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';

let cluster, admin;
const clients = new Set();
const directory = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const connect = async () => { const client = cluster.getPgClient('postgres', '127.0.0.1'); await client.connect(); clients.add(client); await client.query("SET statement_timeout='8s'"); return client; };
const close = async client => { clients.delete(client); await client.end(); };
before(async () => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const databaseDir = await fs.mkdtemp(path.join(temporaryRoot, 'juanfinder-pg-races-'));
  assert.equal(path.dirname(path.resolve(databaseDir)), temporaryRoot);
  assert.ok(path.basename(databaseDir).startsWith('juanfinder-pg-races-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  cluster = new EmbeddedPostgres({ databaseDir, user: 'postgres', password: crypto.randomUUID(), port,
    persistent: false, postgresFlags: ['-h', '127.0.0.1', '-F'], onLog() {}, onError() {} });
  await cluster.initialise();
  await cluster.start();
  admin = await connect();
  await admin.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[])');
  const base = (await fs.readFile(path.join(directory, 'database.sql'), 'utf8')).split('INSERT INTO public.users (user_code')[0].replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '');
  await admin.query(base);
  for (const name of (await fs.readdir(path.join(directory, 'migrations'))).filter(name => name.endsWith('.sql')).sort()) {
    try { await admin.query(await fs.readFile(path.join(directory, 'migrations', name), 'utf8')); }
    catch (error) { throw new Error(`${name}: ${error.message}`); }
  }
});
after(async () => {
  await Promise.all([...clients].map(close));
  if (cluster) await cluster.stop();
});

async function fixture(milliseconds = 10000, existingAdviser) {
  const token = crypto.randomUUID();
  const ids = [];
  for (const [index, role] of ['student', 'student', 'adviser'].entries()) {
    if (role === 'adviser' && existingAdviser) { ids.push(existingAdviser); continue; }
    const result = await admin.query("insert into users(user_code,username,password_hash,name,role,course,adviser_capacity) values($1,$1,'unused',$2,$3,'BSCS',1) returning user_id", [token + index, `${role} ${token}`, role]);
    ids.push(result.rows[0].user_id);
  }
  const [leader, member, adviser] = ids;
  const group = (await admin.query("insert into groups(group_name,course,owner_id,finalized_at) values($1,'BSCS',$2,clock_timestamp()) returning group_id", ['Group ' + token, leader])).rows[0].group_id;
  await admin.query('insert into group_members(group_id,user_id) values($1,$2),($1,$3)', [group, leader, member]);
  const app = (await admin.query("insert into group_adviser_applications(group_id,applicant_id,adviser_id,created_at) values($1,$2,$3,clock_timestamp()-interval '24 hours'+$4*interval '1 millisecond') returning application_id", [group, leader, adviser, milliseconds])).rows[0].application_id;
  return { leader, member, adviser, group, app };
}
const respond = (client, item) => client.query('select respond_to_group_adviser_application($1,$2,true) as status', [item.app, item.adviser]);
async function assertOutcome(item, status) {
  const result = (await admin.query('select status from group_adviser_applications where application_id=$1', [item.app])).rows[0];
  assert.equal(result.status, status);
  const events = (await admin.query('select notification_type from notifications where application_id=$1 and recipient_id=$2', [item.app, item.leader])).rows;
  assert.deepEqual(events.map(row => row.notification_type), [status === 'Accepted' ? 'adviser_application_accepted' : 'adviser_application_expired']);
  assert.equal((await admin.query('select adviser_id from groups where group_id=$1', [item.group])).rows[0].adviser_id, status === 'Accepted' ? item.adviser : null);
  const members = (await admin.query('select adviser_id from users where user_id in($1,$2)', [item.leader, item.member])).rows;
  assert.ok(members.every(row => row.adviser_id === (status === 'Accepted' ? item.adviser : null)));
}
async function waitUntilBlocked(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await admin.query("select wait_event_type from pg_stat_activity where pid=$1", [pid]);
    if (result.rows[0]?.wait_event_type === 'Lock') return;
    await admin.query('select pg_sleep(0.01)');
  }
  throw new Error('Expected a real blocked database session.');
}

for (const blockedOn of ['adviser', 'member']) test(`acceptance waiting on ${blockedOn} cannot use a transaction-start timestamp after the deadline`, { timeout: 20000 }, async () => {
  const item = await fixture(500);
  const holder = await connect(), accepting = await connect(), expiring = await connect();
  try {
    await holder.query('BEGIN');
    await holder.query('select user_id from users where user_id=$1 for update', [blockedOn === 'adviser' ? item.adviser : item.member]);
    const pid = (await accepting.query('select pg_backend_pid() as pid')).rows[0].pid;
    const decision = respond(accepting, item);
    await waitUntilBlocked(pid);
    await admin.query('select pg_sleep(0.6)');
    const scheduler = await expiring.query('select expire_group_adviser_applications() as changed');
    assert.equal(scheduler.rows[0].changed, 0); // global jobs skip the accepting group's lock
    const specificExpiration = expiring.query('select expire_group_adviser_applications($1) as changed', [item.group]);
    await holder.query('COMMIT');
    assert.equal((await decision).rows[0].status, 'Expired');
    await specificExpiration;
    await assertOutcome(item, 'Expired');
    assert.equal((await admin.query('select assigned_groups from adviser_slot_availability where user_id=$1', [item.adviser])).rows[0].assigned_groups, 0);
  } finally { await holder.query('ROLLBACK'); await Promise.all([holder, accepting, expiring].map(close)); }
});

test('acceptance committed before its deadline remains Accepted when expiration later runs', { timeout: 20000 }, async () => {
  const item = await fixture(500);
  const accepting = await connect(), expiring = await connect();
  try {
    assert.equal((await respond(accepting, item)).rows[0].status, 'Accepted');
    await admin.query('select pg_sleep(0.6)');
    await expiring.query('select expire_group_adviser_applications($1)', [item.group]);
    await assertOutcome(item, 'Accepted');
  } finally { await Promise.all([accepting, expiring].map(close)); }
});
test('concurrent expiration and acceptance at an elapsed deadline produce one Expired event', { timeout: 20000 }, async () => {
  const item = await fixture(-1);
  const accepting = await connect(), expiring = await connect();
  try {
    await Promise.all([respond(accepting, item), expiring.query('select expire_group_adviser_applications($1)', [item.group])]);
    await assertOutcome(item, 'Expired');
  } finally { await Promise.all([accepting, expiring].map(close)); }
});
test('two real sessions competing for one adviser slot yield one acceptance and one notification', { timeout: 20000 }, async () => {
  const first = await fixture(), second = await fixture(10000, first.adviser);
  const one = await connect(), two = await connect();
  try {
    const outcomes = await Promise.allSettled([respond(one, first), respond(two, second)]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled' && result.value.rows[0].status === 'Accepted').length, 1);
    assert.equal(outcomes.filter(result => result.status === 'rejected' && /remaining slots/.test(result.reason.message)).length, 1);
    assert.equal((await admin.query('select assigned_groups from adviser_slot_availability where user_id=$1', [first.adviser])).rows[0].assigned_groups, 1);
    assert.equal((await admin.query("select count(*)::int as count from notifications where application_id in($1,$2) and notification_type='adviser_application_accepted'", [first.app, second.app])).rows[0].count, 1);
  } finally { await Promise.all([one, two].map(close)); }
});
