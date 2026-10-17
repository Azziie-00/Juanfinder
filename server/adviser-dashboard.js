const missingRpcFunction = error => ['PGRST202', '42883'].includes(error?.code);
// An older 014 report can survive the role-profile split (or be reapplied later).
// Recover only known moved report columns; permissions and unrelated SQL errors fail closed.
const staleReportColumns = error => error?.code === '42703'
    && /column\s+(?:[a-z_]+\.)?(?:course|adviser_capacity)\s+does not exist/i.test(error.message || '');
const missingActivityColumn = error => ['42703', 'PGRST204'].includes(error?.code)
    && String(error?.message || '').includes('previous_activity_at');

// Advance by the actual returned row count, even if PostgREST caps pages below 100.
async function readAll(makeQuery) {
    const rows = [];
    for (;;) {
        const { data, error } = await makeQuery().range(rows.length, rows.length + 99);
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error('Invalid dashboard records.');
        if (!data.length) return rows;
        rows.push(...data);
    }
}

async function readBatches(ids, makeQuery) {
    const rows = [];
    for (let i = 0; i < ids.length; i += 100) {
        rows.push(...await readAll(() => makeQuery(ids.slice(i, i + 100))));
    }
    return rows;
}

async function loadAdviserDashboard(supabase, adviser, search) {
    const result = await supabase.rpc('get_adviser_dashboard_report', { p_adviser_id: adviser.user_id, p_search: search });
    if (!result.error) return result.data;
    if (!missingRpcFunction(result.error) && !staleReportColumns(result.error)) throw result.error;

    // Compatibility path for deployments without 014 or with a stale RPC schema cache.
    // Every group is scoped to the authenticated identity before reading any students.
    const capacity = Number(adviser.adviser_capacity);
    if (adviser.adviser_capacity == null || !Number.isFinite(capacity) || capacity < 0) throw new Error('Adviser capacity is not configured.');
    const groups = await readAll(() => supabase.from('groups').select('group_id,group_name,course,owner_id')
        .eq('adviser_id', adviser.user_id).order('group_name').order('group_id'));
    const memberships = await readBatches(groups.map(g => g.group_id), ids => supabase.from('group_members')
        .select('group_id,user_id').in('group_id', ids).order('group_id').order('user_id'));
    const idsByGroup = new Map(groups.map(g => [String(g.group_id), new Set(g.owner_id == null ? [] : [String(g.owner_id)])]));
    for (const member of memberships) idsByGroup.get(String(member.group_id))?.add(String(member.user_id));
    const ids = [...new Set([...idsByGroup.values()].flatMap(values => [...values]))];
    const students = await readBatches(ids, batch => supabase.from('users').select('user_id,user_code,name')
        .in('user_id', batch).eq('role', 'student').order('user_id'));
    const profiles = await readBatches(students.map(s => s.user_id), batch => supabase.from('students')
        .select('user_id,course').in('user_id', batch).order('user_id'));
    const courses = new Map(profiles.map(s => [String(s.user_id), s.course]));
    for (const student of students) student.course = courses.get(String(student.user_id));
    const byId = new Map(students.map(s => [String(s.user_id), s]));
    const term = search.trim().toLowerCase();
    const records = groups.map(group => {
        const members = [...idsByGroup.get(String(group.group_id))].filter(id => byId.has(id)).map(id => {
            const student = byId.get(id);
            return { UserID: Number(student.user_id), UserCode: student.user_code, Name: student.name, Course: student.course, IsLeader: id === String(group.owner_id) };
        }).sort((a, b) => a.Name.localeCompare(b.Name) || a.UserID - b.UserID);
        return { GroupID: Number(group.group_id), GroupName: group.group_name, Course: group.course, MemberCount: members.length, Members: members };
    });
    return {
        AdviserName: adviser.name,
        Summary: { Groups: groups.length, StudentMembers: byId.size, Capacity: capacity, AvailableSlots: Math.max(0, capacity - groups.length) },
        Groups: records.filter(g => !term || g.Members.some(s => s.Name.toLowerCase().includes(term) || s.UserCode.toLowerCase().includes(term))),
    };
}

module.exports = { loadAdviserDashboard, missingRpcFunction, missingActivityColumn };
