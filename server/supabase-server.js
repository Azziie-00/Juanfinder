const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config();

const express = require("express");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");
const cors = require("cors");

const app = express();
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

const allowedOrigins = (process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        const isLocalDevelopmentOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        const isVercelOrigin = /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin);
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin) || isLocalDevelopmentOrigin || isVercelOrigin) {
            return callback(null, true);
        }
        callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true,
}));
app.use(express.json());

const dbRequired = (_req, res, next) => {
    if (!supabase) return res.status(503).json({ success: false, message: "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." });
    next();
};
const requireAdmin = (req, res, next) => {
    if (!["admin", "superadmin"].includes(req.user?.role)) return res.status(403).json({ success: false, message: "Admin access is required." });
    next();
};
const userDto = (user) => ({
    UserID: Number(user.user_id), UserCode: user.user_code, Username: user.username,
    Name: user.name, Role: user.role, IsActive: user.is_active, CreatedAt: user.created_at,
    Course: user.course, AdviseeCount: Number(user.advisee_count || 0),
});
const groupDto = (group) => ({
    GroupID: Number(group.group_id), GroupName: group.group_name, Course: group.course,
    Specialty: group.specialty, Description: group.description, OwnerID: group.owner_id == null ? null : Number(group.owner_id),
    Status: group.status, MaxMembers: group.max_members, CreatedAt: group.created_at,
});
const rpcError = (res, error, messages) => {
    const message = error?.message || "Database operation failed.";
    const match = Object.entries(messages).find(([needle]) => message.includes(needle));
    res.status(match?.[1].status || 500).json({ success: false, message: match?.[1].message || "Database operation failed." });
};
const RPC_MESSAGES = {
    "You can only create or belong to one group": { status: 409, message: "You can only create or belong to one group." },
    "You can only belong to one group": { status: 409, message: "You can only belong to one group." },
    "Your join request is still pending": { status: 409, message: "Your join request is still pending." },
    "This group is full": { status: 409, message: "This group is full." },
    "Group not found": { status: 404, message: "Group not found." },
    "Only the group owner": { status: 403, message: "Only the group owner can perform this action." },
    "Only active students": { status: 403, message: "Only active students can be added." },
};

app.use(dbRequired);

const getUser = async (req, res, next) => {
    const userId = Number(req.header("x-user-id"));
    if (!Number.isInteger(userId) || userId < 1) return res.status(401).json({ success: false, message: "A signed-in user is required." });
    try {
        const { data, error } = await supabase.from("users").select("*").eq("user_id", userId).eq("is_active", true).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(401).json({ success: false, message: "User account is not active." });
        req.user = data;
        const previewRole = req.header("x-view-role");
        req.effectiveRole = data.role === "superadmin" && process.env.NODE_ENV !== "production" && ["student", "adviser", "admin"].includes(previewRole)
            ? previewRole
            : data.role;
        next();
    } catch (error) {
        console.error("User authorization error:", error);
        res.status(500).json({ success: false, message: "Unable to verify the signed-in user." });
    }
};
const requireStudent = (req, res, next) => {
    if (req.effectiveRole !== "student") return res.status(403).json({ success: false, message: "Only students can perform this action." });
    next();
};

app.post("/api/login", async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) return res.status(400).json({ success: false, message: "Username, password, and role are required." });
    try {
        const normalizedLogin = String(username).trim();
        const loginName = normalizedLogin.toLowerCase() === "demo" ? `demo.${role}` : normalizedLogin;
        const allowedRoles = role === "admin" ? ["admin", "superadmin"] : [role];
        let { data: user, error } = await supabase.from("users").select("*").eq("username", loginName).in("role", allowedRoles).eq("is_active", true).maybeSingle();
        if (error) throw error;
        if (!user) {
            const result = await supabase.from("users").select("*").eq("user_code", loginName).in("role", allowedRoles).eq("is_active", true).maybeSingle();
            if (result.error) throw result.error;
            user = result.data;
        }
        if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
            return res.status(401).json({ success: false, message: "Invalid username, password, or role." });
        }
        res.json({ success: true, message: "Login successful.", user: { id: user.user_id, userCode: user.user_code, username: user.username, name: user.name || user.username, role: user.role, course: user.course } });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.get("/api/health/db", async (_req, res) => {
    const { count, error } = await supabase.from("users").select("user_id", { count: "exact", head: true });
    if (error) return res.status(503).json({ connected: false, usersTable: false, message: "JuanFinder cannot reach the Supabase users table." });
    res.json({ connected: true, usersTable: true, hasUsers: count > 0 });
});

app.get("/api/advisers", getUser, async (_req, res) => {
    const { data, error } = await supabase.from("users").select("user_id,user_code,username,name,bio,requirements").eq("role", "adviser").eq("is_active", true).order("name");
    if (error) return res.status(500).json({ success: false, message: "Unable to load advisers." });
    res.json(data.map((user) => ({ UserID: Number(user.user_id), UserCode: user.user_code, Username: user.username, Name: user.name, Bio: user.bio, Requirements: user.requirements })));
});

app.get("/api/students", getUser, async (_req, res) => {
    const [studentsResult, membershipsResult, groupsResult] = await Promise.all([
        supabase.from("users").select("user_id,user_code,username,name,course,year_level,specialty,skills").eq("role", "student").eq("is_active", true).order("name"),
        supabase.from("group_members").select("user_id,group_id"),
        supabase.from("groups").select("group_id,group_name"),
    ]);
    if (studentsResult.error || membershipsResult.error || groupsResult.error) {
        return res.status(500).json({ success: false, message: "Unable to load students." });
    }
    const groupNames = new Map(groupsResult.data.map((group) => [Number(group.group_id), group.group_name]));
    const groupsByUser = new Map(membershipsResult.data.map((membership) => [Number(membership.user_id), groupNames.get(Number(membership.group_id))]));
    res.json(studentsResult.data.map((student) => {
        const group = groupsByUser.get(Number(student.user_id));
        return {
            id: String(student.user_id), name: student.name || student.username,
            specialty: student.specialty || "Unspecified", group: group || "--",
            availability: group ? "0" : "1",
            year: student.year_level || "Unspecified", course: student.course || "Unspecified",
            skills: student.skills || [], status: group ? "Has a group" : "Looking for group",
            email: student.username,
        };
    }));
});

app.patch("/api/adviser/profile", getUser, async (req, res) => {
    if (req.effectiveRole !== "adviser") return res.status(403).json({ success: false, message: "Only advisers can edit adviser details." });
    const bio = String(req.body.bio || "").trim();
    const requirements = Array.isArray(req.body.requirements) ? req.body.requirements.map((item) => String(item).trim()).filter(Boolean).join("\n") : String(req.body.requirements || "").trim();
    const { error } = await supabase.from("users").update({ bio, requirements }).eq("user_id", req.user.user_id).eq("role", "adviser");
    if (error) return res.status(500).json({ success: false, message: "Unable to save adviser details." });
    res.json({ success: true });
});

app.get("/api/dashboard/stats", getUser, async (_req, res) => {
    const [students, advisers] = await Promise.all([
        supabase.from("users").select("user_id", { count: "exact", head: true }).eq("role", "student").eq("is_active", true),
        supabase.from("users").select("user_id", { count: "exact", head: true }).eq("role", "adviser").eq("is_active", true),
    ]);
    if (students.error || advisers.error) return res.status(500).json({ success: false, message: "Unable to load dashboard stats." });
    res.json({ finder: students.count || 0, adviser: advisers.count || 0 });
});

app.get("/api/groups", getUser, async (req, res) => {
    const [groupsResult, membersResult, requestsResult, usersResult] = await Promise.all([
        supabase.from("groups").select("*").order("created_at", { ascending: false }),
        supabase.from("group_members").select("group_id,user_id"),
        supabase.from("group_join_requests").select("group_id,user_id,status").eq("status", "Pending"),
        supabase.from("users").select("user_id,name"),
    ]);
    const error = groupsResult.error || membersResult.error || requestsResult.error || usersResult.error;
    if (error) return res.status(500).json({ success: false, message: "Unable to load groups." });
    const names = new Map(usersResult.data.map((user) => [Number(user.user_id), user.name]));
    const membersByGroup = new Map();
    for (const member of membersResult.data) {
        const key = Number(member.group_id);
        membersByGroup.set(key, [...(membersByGroup.get(key) || []), Number(member.user_id)]);
    }
    const pendingSet = new Set(requestsResult.data.map((request) => `${request.group_id}:${request.user_id}`));
    const rows = groupsResult.data.filter((group) => {
        const members = membersByGroup.get(Number(group.group_id)) || [];
        return group.status === "Open" || members.includes(Number(req.user.user_id)) || pendingSet.has(`${group.group_id}:${req.user.user_id}`);
    }).map((group) => {
        const memberIds = membersByGroup.get(Number(group.group_id)) || [];
        const orderedMemberIds = [...new Set([
            ...(group.owner_id == null ? [] : [Number(group.owner_id)]),
            ...memberIds,
        ])];
        const memberNames = orderedMemberIds.map((id) => names.get(id)).filter(Boolean);
        return {
            ...groupDto(group), MemberCount: orderedMemberIds.length, MemberNames: memberNames.join("|"),
            IsMember: memberIds.includes(Number(req.user.user_id)) ? 1 : 0,
            IsPending: pendingSet.has(`${group.group_id}:${req.user.user_id}`) ? 1 : 0,
        };
    });
    res.json(rows);
});

app.post("/api/groups/:id/join", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    if (!Number.isInteger(groupId)) return res.status(400).json({ success: false, message: "A valid group is required." });
    const { error } = await supabase.rpc("request_to_join_group", { p_group_id: groupId, p_user_id: req.user.user_id, p_allow_superadmin: req.effectiveRole === "student" && req.user.role === "superadmin" && process.env.NODE_ENV !== "production" });
    if (error) return rpcError(res, error, RPC_MESSAGES);
    res.status(201).json({ success: true, pending: true });
});

app.get("/api/my-group", getUser, async (req, res) => {
    const userId = req.user.user_id;
    const [groupsResult, membershipsResult, requestsResult] = await Promise.all([
        supabase.from("groups").select("*").order("created_at", { ascending: false }),
        supabase.from("group_members").select("group_id,user_id").eq("user_id", userId),
        supabase.from("group_join_requests").select("request_id,group_id,user_id,created_at").eq("user_id", userId).eq("status", "Pending").order("created_at", { ascending: true }),
    ]);
    if (groupsResult.error || membershipsResult.error || requestsResult.error) return res.status(500).json({ success: false, message: "Unable to load your group." });
    const memberships = new Set(membershipsResult.data.map((row) => Number(row.group_id)));
    const pendingIds = new Set(requestsResult.data.map((row) => Number(row.group_id)));
    const groups = groupsResult.data.filter((group) => Number(group.owner_id) === Number(userId) || memberships.has(Number(group.group_id)) || pendingIds.has(Number(group.group_id)));
    groups.sort((a, b) => {
        const priority = (group) => Number(group.owner_id) === Number(userId) ? 0 : memberships.has(Number(group.group_id)) ? 1 : 2;
        return priority(a) - priority(b) || new Date(b.created_at) - new Date(a.created_at);
    });
    if (!groups.length) return res.json({ group: null });
    const group = groups[0];
    const [membersResult, pendingResult] = await Promise.all([
        supabase.from("group_members").select("user_id").eq("group_id", group.group_id),
        Number(group.owner_id) === Number(userId)
            ? supabase.from("group_join_requests").select("request_id,user_id,created_at").eq("group_id", group.group_id).eq("status", "Pending").order("created_at")
            : Promise.resolve({ data: [], error: null }),
    ]);
    if (membersResult.error || pendingResult.error) return res.status(500).json({ success: false, message: "Unable to load your group." });
    const userIds = [...new Set([...membersResult.data.map((row) => row.user_id), ...pendingResult.data.map((row) => row.user_id)])];
    const usersResult = userIds.length ? await supabase.from("users").select("user_id,user_code,name,role,username").in("user_id", userIds) : { data: [], error: null };
    if (usersResult.error) return res.status(500).json({ success: false, message: "Unable to load your group." });
    const users = new Map(usersResult.data.map((user) => [Number(user.user_id), user]));
    res.json({ group: {
        ...groupDto(group), MembershipStatus: pendingIds.has(Number(group.group_id)) && !memberships.has(Number(group.group_id)) ? "Pending" : "Member",
        members: membersResult.data.map((row) => { const user = users.get(Number(row.user_id)); return { UserID: Number(row.user_id), Name: user?.name, Role: user?.role }; }),
        pending: pendingResult.data.map((row) => { const user = users.get(Number(row.user_id)); return { RequestID: Number(row.request_id), UserID: Number(row.user_id), Name: user?.name, Username: user?.username, UserCode: user?.user_code }; }),
    } });
});

app.post("/api/groups/:id/requests/:requestId/approve", getUser, requireStudent, async (req, res) => {
    const { error } = await supabase.rpc("approve_group_request", { p_group_id: Number(req.params.id), p_request_id: Number(req.params.requestId), p_owner_id: req.user.user_id });
    if (error) return rpcError(res, error, RPC_MESSAGES);
    res.json({ success: true });
});

app.delete("/api/groups/:id/requests/:requestId", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    const requestId = Number(req.params.requestId);
    const { data: group, error: groupError } = await supabase.from("groups").select("owner_id").eq("group_id", groupId).maybeSingle();
    if (groupError) return res.status(500).json({ success: false, message: "Unable to decline request." });
    if (!group || Number(group.owner_id) !== Number(req.user.user_id)) return res.status(403).json({ success: false, message: "Only the group owner can decline requests." });
    const { data, error } = await supabase.from("group_join_requests").delete().eq("group_id", groupId).eq("request_id", requestId).eq("status", "Pending").select("request_id");
    if (error) return res.status(500).json({ success: false, message: "Unable to decline request." });
    if (!data.length) return res.status(403).json({ success: false, message: "Only the group owner can decline requests." });
    res.json({ success: true });
});

app.post("/api/groups", getUser, requireStudent, async (req, res) => {
    const { name, course, specialty, maxMembers, description } = req.body;
    const max = Number(maxMembers);
    if (!name?.trim() || !course?.trim() || !specialty?.trim() || !Number.isInteger(max) || max < 2 || max > 4) {
        return res.status(400).json({ success: false, message: "Group name, course, specialty, and a member limit from 2 to 4 are required." });
    }
    const { data, error } = await supabase.rpc("create_group_with_owner", {
        p_name: name.trim(), p_course: course.trim(), p_specialty: specialty.trim(),
        p_description: description?.trim() || "", p_owner_id: req.user.user_id, p_max_members: max,
    });
    if (error) return rpcError(res, error, RPC_MESSAGES);
    const group = Array.isArray(data) ? data[0] : data;
    res.status(201).json({ success: true, group: { ...groupDto(group), MemberCount: 1 } });
});

app.post("/api/groups/:id/members", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    const memberId = Number(req.body.userId);
    if (!Number.isInteger(groupId) || !Number.isInteger(memberId)) return res.status(400).json({ success: false, message: "A valid group and student are required." });
    const { error } = await supabase.rpc("add_student_to_group", { p_group_id: groupId, p_student_id: memberId, p_owner_id: req.user.user_id });
    if (error) return rpcError(res, error, RPC_MESSAGES);
    res.status(201).json({ success: true });
});

app.delete("/api/groups/:id/members/:userId", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    const memberId = Number(req.params.userId);
    const { data: group, error: groupError } = await supabase.from("groups").select("owner_id").eq("group_id", groupId).maybeSingle();
    if (groupError) return res.status(500).json({ success: false, message: "Unable to remove the student." });
    if (!group) return res.status(404).json({ success: false, message: "Group not found." });
    if (Number(group.owner_id) !== Number(req.user.user_id)) return res.status(403).json({ success: false, message: "Only the group owner can manage members." });
    if (memberId === Number(req.user.user_id)) return res.status(400).json({ success: false, message: "The group owner cannot be removed." });
    const { data: member, error: memberError } = await supabase.from("group_members").select("users!group_members_user_id_fkey(role)").eq("group_id", groupId).eq("user_id", memberId).maybeSingle();
    if (memberError) return res.status(500).json({ success: false, message: "Unable to remove the student." });
    if (!member) return res.status(404).json({ success: false, message: "Student is not in this group." });
    if (member.users.role !== "student") return res.status(403).json({ success: false, message: "Advisers and administrators cannot be removed." });
    const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", memberId);
    if (error) return res.status(500).json({ success: false, message: "Unable to remove the student." });
    await supabase.from("groups").update({ status: "Open" }).eq("group_id", groupId);
    res.json({ success: true });
});

app.get("/api/admin/summary", getUser, requireAdmin, async (_req, res) => {
    const count = (table, filters = {}) => {
        let query = supabase.from(table).select("*", { count: "exact", head: true });
        for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
        return query;
    };
    const results = await Promise.all([count("users"), count("users", { is_active: true }), count("users", { role: "student" }), count("users", { role: "adviser" }), count("groups"), count("groups", { status: "Open" })]);
    if (results.some((result) => result.error)) return res.status(500).json({ success: false, message: "Unable to load admin summary." });
    const [users, activeUsers, students, advisers, groups, openGroups] = results.map((result) => result.count || 0);
    res.json({ users, activeUsers, students, advisers, groups, openGroups });
});

app.get("/api/admin/courses", getUser, requireAdmin, async (_req, res) => {
    const [catalog, assigned] = await Promise.all([
        supabase.from("courses").select("course_code").order("course_code"),
        supabase.from("users").select("course").eq("role", "student").eq("is_active", true).not("course", "is", null).neq("course", "").neq("course", "Unspecified"),
    ]);
    if (catalog.error || assigned.error) return res.status(500).json({ success: false, message: "Unable to load courses." });
    res.json([...new Set([...catalog.data.map((row) => row.course_code), ...assigned.data.map((row) => row.course)])].sort());
});

app.get("/api/admin/advisers", getUser, requireAdmin, async (_req, res) => {
    const { data, error } = await supabase.from("users").select("user_id,name,user_code,username").eq("role", "adviser").eq("is_active", true).order("name");
    if (error) return res.status(500).json({ success: false, message: "Unable to load advisers." });
    res.json(data.map((adviser) => ({ UserID: Number(adviser.user_id), Name: adviser.name, UserCode: adviser.user_code, Username: adviser.username })));
});

app.get("/api/admin/users", getUser, requireAdmin, async (req, res) => {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 10);
    const offset = (page - 1) * pageSize;
    const role = ["student", "adviser"].includes(req.query.role) ? req.query.role : null;
    let query = supabase.from("users").select("*", { count: "exact" }).order("created_at", { ascending: false }).order("user_id", { ascending: false });
    if (role) query = query.eq("role", role);
    const { data, count, error } = await query.range(offset, offset + pageSize - 1);
    if (error) return res.status(500).json({ success: false, message: "Unable to load users." });
    const total = count || 0;
    const adviserCounts = new Map();
    if (role === "adviser" && data.length) {
        const adviserIds = data.map((adviser) => adviser.user_id);
        const advisees = await supabase.from("users").select("adviser_id").eq("role", "student").eq("is_active", true).in("adviser_id", adviserIds);
        if (advisees.error) return res.status(500).json({ success: false, message: "Unable to load adviser advisees." });
        for (const advisee of advisees.data) adviserCounts.set(Number(advisee.adviser_id), (adviserCounts.get(Number(advisee.adviser_id)) || 0) + 1);
    }
    res.json({ items: data.map((record) => userDto({ ...record, advisee_count: adviserCounts.get(Number(record.user_id)) || 0 })), total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
});

app.post("/api/admin/users", getUser, requireAdmin, async (req, res) => {
    const { username, userCode, role, password, course, yearLevel, specialty, skills, adviserId } = req.body;
    if (!username || !userCode || !password || !["student", "adviser", "admin", "superadmin"].includes(role)) return res.status(400).json({ success: false, message: "Username, ID, role, and password are required." });
    const passwordHash = await bcrypt.hash(String(password), 12);
    if (role === "student" && adviserId) {
        const { data: adviser, error: adviserError } = await supabase.from("users").select("user_id").eq("user_id", Number(adviserId)).eq("role", "adviser").eq("is_active", true).maybeSingle();
        if (adviserError) return res.status(500).json({ success: false, message: "Unable to verify the selected adviser." });
        if (!adviser) return res.status(400).json({ success: false, message: "Select an active adviser." });
    }
    const { data, error } = await supabase.from("users").insert({
        username: username.trim(), user_code: userCode.trim(), password_hash: passwordHash, name: username.trim(), role,
        ...(role === "student" ? {
            course: String(course || "Unspecified").trim() || "Unspecified",
            year_level: String(yearLevel || "").trim(),
            specialty: String(specialty || "").trim(),
            skills: Array.isArray(skills) ? skills.map(String) : [],
            adviser_id: adviserId ? Number(adviserId) : null,
        } : {}),
    }).select("*").single();
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ success: false, message: error.code === "23505" ? "Username or ID already exists." : "Unable to add user." });
    res.status(201).json({ success: true, user: userDto(data) });
});

app.delete("/api/admin/users/:id", getUser, requireAdmin, async (req, res) => {
    const { data, error } = await supabase.from("users").delete().eq("user_id", Number(req.params.id)).not("role", "in", "(admin,superadmin)").select("user_id");
    if (error) return res.status(500).json({ success: false, message: "Unable to remove user." });
    if (!data.length) return res.status(403).json({ success: false, message: "Admin accounts cannot be removed." });
    res.json({ success: true });
});

app.patch("/api/admin/users/:id", getUser, requireAdmin, async (req, res) => {
    const { username, userCode, role, password } = req.body;
    if (!username || !userCode || !["student", "adviser", "admin"].includes(role)) return res.status(400).json({ success: false, message: "Username, ID, and role are required." });
    const updates = { username: username.trim(), user_code: userCode.trim(), name: username.trim(), role };
    if (password) updates.password_hash = await bcrypt.hash(String(password), 12);
    const { data, error } = await supabase.from("users").update(updates).eq("user_id", Number(req.params.id)).neq("role", "superadmin").select("user_id");
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ success: false, message: error.code === "23505" ? "Username or ID already exists." : "Unable to edit user." });
    if (!data.length) return res.status(403).json({ success: false, message: "This account cannot be edited." });
    res.json({ success: true });
});

app.patch("/api/admin/users/:id/status", getUser, requireAdmin, async (req, res) => {
    const { error } = await supabase.from("users").update({ is_active: req.body.active === true }).eq("user_id", Number(req.params.id));
    if (error) return res.status(500).json({ success: false, message: "Unable to update user status." });
    res.json({ success: true });
});

app.get("/api/admin/groups", getUser, requireAdmin, async (_req, res) => {
    const [groupsResult, membersResult] = await Promise.all([
        supabase.from("groups").select("group_id,group_name,course,status,max_members").order("group_name"),
        supabase.from("group_members").select("group_id"),
    ]);
    if (groupsResult.error || membersResult.error) return res.status(500).json({ success: false, message: "Unable to load groups." });
    const counts = new Map();
    for (const member of membersResult.data) counts.set(Number(member.group_id), (counts.get(Number(member.group_id)) || 0) + 1);
    res.json(groupsResult.data.map((group) => {
        const memberCount = counts.get(Number(group.group_id)) || 0;
        return { GroupID: Number(group.group_id), GroupName: group.group_name, Course: group.course, Status: memberCount >= group.max_members ? "Full" : "Open", MaxMembers: group.max_members, MemberCount: memberCount };
    }));
});

app.delete("/api/admin/groups/:id", getUser, requireAdmin, async (req, res) => {
    const { error } = await supabase.from("groups").delete().eq("group_id", Number(req.params.id));
    if (error) return res.status(500).json({ success: false, message: "Unable to delete group." });
    res.json({ success: true });
});

module.exports = app;
