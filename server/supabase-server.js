const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config();

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
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
        if (allowedOrigins.includes(origin) || isLocalDevelopmentOrigin || isVercelOrigin) {
            return callback(null, true);
        }
        callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true,
}));
app.use(express.json({ limit: "15mb" }));

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
    Name: user.name, FirstName: user.first_name, LastName: user.last_name,
    Role: user.role, IsActive: user.is_active,
    Status: user.expires_at && new Date(user.expires_at) <= new Date() ? "Expired" : user.is_active ? "Active" : "Disabled",
    CreatedAt: user.created_at, Course: user.course, ExpiresAt: user.expires_at,
    AdviseeCount: Number(user.advisee_count || 0),
});
const groupDto = (group) => ({
    GroupID: Number(group.group_id), GroupName: group.group_name, Course: group.course,
    Specialty: group.specialty, Description: group.description, OwnerID: group.owner_id == null ? null : Number(group.owner_id),
    Status: group.finalized_at ? "Finalized" : group.status, FinalizedAt: group.finalized_at || null,
    MaxMembers: group.max_members, CreatedAt: group.created_at,
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
    "This group is finalized": { status: 409, message: "This group is finalized and membership is locked." },
    "Join request not found or expired": { status: 410, message: "This join request has expired or is no longer pending." },
    "Group not found": { status: 404, message: "Group not found." },
    "Only the group owner": { status: 403, message: "Only the group owner can perform this action." },
    "Only active students": { status: 403, message: "Only active students can be added." },
};

const USER_ID_PATTERN = /^\d{1,11}$/;
const getPasswordRequirements = (password) => {
    const missing = [];
    if (!/[A-Z]/.test(String(password))) missing.push('one uppercase letter');
    if (!/[a-z]/.test(String(password))) missing.push('one lowercase letter');
    if (!/[0-9]/.test(String(password))) missing.push('one number');
    if (!/[^A-Za-z0-9]/.test(String(password))) missing.push('one special character');
    return missing;
};
const validateUserCode = (value) => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return 'User ID is required.';
    if (!USER_ID_PATTERN.test(trimmed)) return 'User ID must contain only digits and cannot exceed 11 characters.';
    return '';
};
const validatePassword = (password) => {
    const missing = getPasswordRequirements(password);
    if (!missing.length) return '';
    return `Password must include ${missing.join(', ')}.`;
};
const buildGeneratedUsername = (firstName, lastName, userCode) => {
    const safeFirst = String(firstName ?? '').trim();
    const safeLast = String(lastName ?? '').trim();
    const safeUserCode = String(userCode ?? '').trim();
    const base = `${safeFirst}.${safeLast}`.replace(/[^a-zA-Z0-9._-]+/g, '.').replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '').toLowerCase();
    return `${base || 'user'}${safeUserCode ? `.${safeUserCode}` : ''}`;
};
const normalizeNamePart = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

app.use(dbRequired);

const getUser = async (req, res, next) => {
    const token = req.header("authorization")?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
    if (!token) return res.status(401).json({ success: false, message: "A valid signed-in session is required." });
    try {
        const sessionHash = crypto.createHash("sha256").update(token).digest("hex");
        const { data: session, error: sessionError } = await supabase.from("auth_sessions")
            .select("user_id,expires_at").eq("session_hash", sessionHash).gt("expires_at", new Date().toISOString()).maybeSingle();
        if (sessionError) throw sessionError;
        if (!session) return res.status(401).json({ success: false, message: "Your session has expired. Sign in again." });
        const { data, error } = await supabase.from("users").select("*").eq("user_id", session.user_id)
            .eq("is_active", true).maybeSingle();
        if (error) throw error;
        if (!data || (data.expires_at && new Date(data.expires_at) <= new Date())) {
            return res.status(401).json({ success: false, message: "User account is not active or has expired." });
        }
        if (data.password_change_required && !["/api/password/change", "/api/logout"].includes(req.path)) {
            return res.status(403).json({ success: false, passwordChangeRequired: true, message: "Change the temporary password before accessing this feature." });
        }
        req.user = data;
        req.sessionHash = sessionHash;
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
        if (user.expires_at && new Date(user.expires_at) <= new Date()) {
            await supabase.from("users").update({ is_active: false }).eq("user_id", user.user_id);
            return res.status(401).json({ success: false, message: "This account has expired. Contact an administrator." });
        }
        const sessionToken = crypto.randomBytes(32).toString("hex");
        const sessionHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const { error: sessionError } = await supabase.from("auth_sessions").insert({
            session_hash: sessionHash, user_id: user.user_id, expires_at: expiresAt,
        });
        if (sessionError) throw sessionError;
        await supabase.from("auth_sessions").delete().lt("expires_at", new Date().toISOString());
        res.json({ success: true, message: "Login successful.", user: {
            id: user.user_id, userCode: user.user_code, username: user.username,
            name: user.name || user.username, role: user.role, course: user.course,
            sessionToken, passwordChangeRequired: user.password_change_required,
        } });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post("/api/logout", getUser, async (req, res) => {
    const { error } = await supabase.from("auth_sessions").delete().eq("session_hash", req.sessionHash);
    if (error) return res.status(500).json({ success: false, message: "Unable to end the session." });
    res.json({ success: true });
});

app.post("/api/password/change", getUser, async (req, res) => {
    const password = String(req.body.password ?? "");
    if (!req.user.password_change_required) {
        return res.status(409).json({ success: false, message: "A temporary password change is not required for this account." });
    }
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ success: false, message: passwordError });
    if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ success: false, message: "Password must be between 8 and 128 characters." });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const { error } = await supabase.rpc("complete_temporary_account", {
        p_user_id: req.user.user_id, p_password_hash: passwordHash,
    });
    if (error) return res.status(500).json({ success: false, message: "Unable to complete the temporary password change." });
    res.json({ success: true });
});

app.get("/api/health/db", async (_req, res) => {
    const { count, error } = await supabase.from("users").select("user_id", { count: "exact", head: true });
    if (error) return res.status(503).json({ connected: false, usersTable: false, message: "JuanFinder cannot reach the Supabase users table." });
    res.json({ connected: true, usersTable: true, hasUsers: count > 0 });
});

app.get("/api/profile", getUser, async (req, res) => {
    const user = req.user;
    res.json({
        UserID: Number(user.user_id),
        FirstName: user.first_name || user.name.split(/\s+/)[0] || "",
        LastName: user.last_name || user.name.split(/\s+/).slice(1).join(" "),
        Name: user.name,
        UserCode: user.user_code,
        Course: user.course,
        YearLevel: user.year_level,
        Specialty: user.specialty,
        Birthdate: user.birthdate,
        Skills: user.skills || [],
        Bio: user.bio || "",
        Gender: user.gender || "",
        Socials: user.socials || "",
        Requirements: user.requirements || "",
    });
});

app.patch("/api/profile", getUser, requireStudent, async (req, res) => {
    const firstName = normalizeNamePart(req.body.firstName);
    const lastName = normalizeNamePart(req.body.lastName);
    const bio = String(req.body.bio ?? "").trim();
    const gender = String(req.body.gender ?? "").trim();
    const socials = String(req.body.socials ?? "").trim();
    const birthdate = req.body.birthdate ? String(req.body.birthdate).trim() : null;
    const skills = Array.isArray(req.body.skills) ? req.body.skills.map((item) => String(item).trim()).filter(Boolean).slice(0, 30) : [];
    if (!firstName || !lastName) return res.status(400).json({ success: false, message: "First name and last name are required." });
    if (firstName.length > 80 || lastName.length > 80 || bio.length > 2000 || socials.length > 500 || skills.some((skill) => skill.length > 80)) {
        return res.status(400).json({ success: false, message: "One or more profile fields exceed the allowed length." });
    }
    if (gender && !["Male", "Female", "Prefer not to say"].includes(gender)) {
        return res.status(400).json({ success: false, message: "Select a valid gender option." });
    }
    if (birthdate && (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || Number.isNaN(Date.parse(`${birthdate}T00:00:00Z`)) || birthdate > new Date().toISOString().slice(0, 10))) {
        return res.status(400).json({ success: false, message: "Enter a valid birthdate that is not in the future." });
    }
    const name = `${firstName} ${lastName}`;
    const { data, error } = await supabase.from("users").update({
        first_name: firstName, last_name: lastName, name, bio, gender, socials, skills, birthdate,
    }).eq("user_id", req.user.user_id).eq("role", "student")
        .select("user_id,first_name,last_name,name,user_code,course,year_level,specialty,skills,bio,gender,socials,birthdate").single();
    if (error) return res.status(500).json({ success: false, message: "Unable to save your profile." });
    res.json({ success: true, profile: data });
});

const PORTFOLIO_BUCKET = "student-portfolios";
const MAX_PORTFOLIO_FILE_SIZE = 10 * 1024 * 1024;
const PORTFOLIO_TYPES = new Map([
    ["application/pdf", "pdf"], ["image/jpeg", "jpg"], ["image/png", "png"],
    ["image/webp", "webp"], ["text/plain", "txt"], ["application/msword", "doc"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
]);
const hasExpectedPortfolioSignature = (mimeType, buffer) => {
    if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
    if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    if (mimeType === "application/msword") return buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    }
    if (mimeType === "text/plain") {
        try { new TextDecoder("utf-8", { fatal: true }).decode(buffer); return !buffer.includes(0); }
        catch { return false; }
    }
    return false;
};
const portfolioDto = (entry) => ({
    PortfolioID: Number(entry.portfolio_id), UserID: Number(entry.user_id), Course: entry.course,
    Title: entry.project_title, Category: entry.category, Description: entry.description,
    FileName: entry.file_name, FileType: entry.file_type, FileSize: Number(entry.file_size),
    CreatedAt: entry.created_at,
});

app.get("/api/portfolio", getUser, async (req, res) => {
    let query = supabase.from("portfolio_entries").select("*").order("created_at", { ascending: false });
    const isCourseAdmin = ["admin", "superadmin"].includes(req.user.role) && Boolean(req.query.course);
    if (isCourseAdmin) {
        query = query.eq("course", String(req.query.course));
    } else {
        query = query.eq("user_id", req.user.user_id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ success: false, message: "Unable to load portfolio entries." });
    if (!isCourseAdmin) return res.json(data.map(portfolioDto));
    const userIds = [...new Set(data.map((entry) => Number(entry.user_id)))];
    const usersResult = userIds.length
        ? await supabase.from("users").select("user_id,name,user_code").in("user_id", userIds)
        : { data: [], error: null };
    if (usersResult.error) return res.status(500).json({ success: false, message: "Unable to load portfolio owners." });
    const users = new Map(usersResult.data.map((record) => [Number(record.user_id), record]));
    res.json(data.map((entry) => ({
        ...portfolioDto(entry),
        StudentName: users.get(Number(entry.user_id))?.name || "Student",
        StudentCode: users.get(Number(entry.user_id))?.user_code || "",
    })));
});

app.post("/api/portfolio", getUser, requireStudent, async (req, res) => {
    const title = String(req.body.title ?? "").trim();
    const category = String(req.body.category ?? "Other").trim();
    const description = String(req.body.description ?? "").trim();
    const fileName = path.basename(String(req.body.fileName ?? "")).replace(/[\u0000-\u001f]/g, "").trim();
    const mimeType = String(req.body.mimeType ?? "").toLowerCase();
    const base64 = String(req.body.data ?? "");
    const extension = PORTFOLIO_TYPES.get(mimeType);
    if (!title || title.length > 160 || description.length > 2000 || !fileName || !extension) {
        return res.status(400).json({ success: false, message: "Enter a project title and choose a supported portfolio file." });
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
        || base64.length > Math.ceil(MAX_PORTFOLIO_FILE_SIZE * 4 / 3) + 4) {
        return res.status(413).json({ success: false, message: "The file is too large or invalid. Maximum file size is 10 MB." });
    }
    const fileBuffer = Buffer.from(base64, "base64");
    if (!fileBuffer.length || fileBuffer.length > MAX_PORTFOLIO_FILE_SIZE || fileBuffer.toString("base64") !== base64) {
        return res.status(413).json({ success: false, message: "The file must be smaller than 10 MB." });
    }
    if (!hasExpectedPortfolioSignature(mimeType, fileBuffer)) {
        return res.status(415).json({ success: false, message: "The file content does not match its selected file type." });
    }
    const safeFileName = fileName.slice(0, 180);
    const storagePath = `${req.user.user_id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(PORTFOLIO_BUCKET).upload(storagePath, fileBuffer, {
        contentType: mimeType, upsert: false,
    });
    if (uploadError) {
        console.error("Portfolio storage upload error:", uploadError);
        return res.status(502).json({ success: false, message: "Unable to upload the portfolio file." });
    }
    const { data, error } = await supabase.from("portfolio_entries").insert({
        user_id: req.user.user_id, course: req.user.course || "Unspecified",
        project_title: title, category, description, file_name: safeFileName,
        storage_path: storagePath, file_type: mimeType, file_size: fileBuffer.length,
    }).select("*").single();
    if (error) {
        const { error: cleanupError } = await supabase.storage.from(PORTFOLIO_BUCKET).remove([storagePath]);
        if (cleanupError) console.error("Portfolio upload cleanup error:", cleanupError);
        return res.status(500).json({ success: false, message: "Unable to save portfolio details." });
    }
    res.status(201).json({ success: true, portfolio: portfolioDto(data) });
});

app.get("/api/portfolio/:id/preview", getUser, async (req, res) => {
    const portfolioId = Number(req.params.id);
    if (!Number.isInteger(portfolioId) || portfolioId < 1) return res.status(400).json({ success: false, message: "A valid portfolio entry is required." });
    const { data, error } = await supabase.from("portfolio_entries").select("user_id,course,storage_path")
        .eq("portfolio_id", portfolioId).maybeSingle();
    if (error) return res.status(500).json({ success: false, message: "Unable to load the portfolio file." });
    if (!data) return res.status(404).json({ success: false, message: "Portfolio entry not found." });
    const isPortfolioOwner = Number(data.user_id) === Number(req.user.user_id);
    const isCourseAdmin = ["admin", "superadmin"].includes(req.user.role)
        && String(req.query.course ?? "") === data.course;
    if (!isPortfolioOwner && !isCourseAdmin) {
        return res.status(403).json({ success: false, message: "You cannot access this portfolio file." });
    }
    const { data: signed, error: signedError } = await supabase.storage.from(PORTFOLIO_BUCKET)
        .createSignedUrl(data.storage_path, 60);
    if (signedError) return res.status(500).json({ success: false, message: "Unable to create a secure preview link." });
    res.json({ url: signed.signedUrl });
});

app.delete("/api/portfolio/:id", getUser, async (req, res) => {
    const portfolioId = Number(req.params.id);
    if (!Number.isInteger(portfolioId) || portfolioId < 1) return res.status(400).json({ success: false, message: "A valid portfolio entry is required." });
    const { data: entry, error: lookupError } = await supabase.from("portfolio_entries").select("user_id,course,storage_path")
        .eq("portfolio_id", portfolioId).maybeSingle();
    if (lookupError) return res.status(500).json({ success: false, message: "Unable to load the portfolio entry." });
    if (!entry) return res.status(404).json({ success: false, message: "Portfolio entry not found." });
    const isPortfolioOwner = Number(entry.user_id) === Number(req.user.user_id);
    const isCourseAdmin = ["admin", "superadmin"].includes(req.user.role)
        && String(req.query.course ?? "") === entry.course;
    if (!isPortfolioOwner && !isCourseAdmin) {
        return res.status(403).json({ success: false, message: "You cannot delete this portfolio entry." });
    }
    const { error: storageError } = await supabase.storage.from(PORTFOLIO_BUCKET).remove([entry.storage_path]);
    if (storageError) return res.status(502).json({ success: false, message: "Unable to remove the portfolio file." });
    const { error } = await supabase.from("portfolio_entries").delete().eq("portfolio_id", portfolioId);
    if (error) return res.status(500).json({ success: false, message: "Unable to remove portfolio details." });
    res.json({ success: true });
});

app.get("/api/advisers", getUser, async (_req, res) => {
    const { data, error } = await supabase.from("users").select("user_id,user_code,username,name,bio,gender,requirements").eq("role", "adviser").eq("is_active", true).order("name");
    if (error) return res.status(500).json({ success: false, message: "Unable to load advisers." });
    res.json(data.map((user) => ({ UserID: Number(user.user_id), UserCode: user.user_code, Username: user.username, Name: user.name, Bio: user.bio, Gender: user.gender, Requirements: user.requirements })));
});

app.get("/api/students", getUser, async (req, res) => {
    let studentQuery = supabase.from("users")
        .select("user_id,user_code,username,name,course,year_level,specialty,skills,adviser_id")
        .eq("role", "student").eq("is_active", true).order("name");
    if (req.effectiveRole === "adviser") studentQuery = studentQuery.eq("adviser_id", req.user.user_id);
    const [studentsResult, membershipsResult, groupsResult] = await Promise.all([
        studentQuery,
        supabase.from("group_members").select("user_id,group_id"),
        supabase.from("groups").select("group_id,group_name,status,owner_id,finalized_at"),
    ]);
    if (studentsResult.error || membershipsResult.error || groupsResult.error) {
        return res.status(500).json({ success: false, message: "Unable to load students." });
    }
    const groupById = new Map(groupsResult.data.map((group) => [Number(group.group_id), group]));
    const groupsByUser = new Map(membershipsResult.data.map((membership) => [Number(membership.user_id), groupById.get(Number(membership.group_id))]));
    const ownerIds = [...new Set(groupsResult.data.map((group) => Number(group.owner_id)).filter(Boolean))];
    const ownerResult = ownerIds.length
        ? await supabase.from("users").select("user_id,name").in("user_id", ownerIds)
        : { data: [], error: null };
    if (ownerResult.error) return res.status(500).json({ success: false, message: "Unable to load group leaders." });
    const owners = new Map(ownerResult.data.map((owner) => [Number(owner.user_id), owner.name]));
    res.json(studentsResult.data.map((student) => {
        const group = groupsByUser.get(Number(student.user_id));
        return {
            id: String(student.user_id), name: student.name || student.username,
            specialty: student.specialty || "Unspecified", group: group?.group_name || "--",
            groupStatus: group?.finalized_at ? "Finalized" : group?.status || null,
            groupLeader: group ? owners.get(Number(group.owner_id)) || "Unassigned" : "",
            availability: group ? "0" : "1",
            year: student.year_level || "Unspecified", course: student.course || "Unspecified",
            skills: student.skills || [], status: group ? "Has a group" : "Looking for group",
            email: student.username,
        };
    }));
});

app.get("/api/adviser/groups", getUser, async (req, res) => {
    if (req.effectiveRole !== "adviser") {
        return res.status(403).json({ success: false, message: "Only advisers can view assigned student groups." });
    }
    const { data: assignedStudents, error: studentsError } = await supabase.from("users")
        .select("user_id").eq("role", "student").eq("is_active", true).eq("adviser_id", req.user.user_id);
    if (studentsError) return res.status(500).json({ success: false, message: "Unable to load assigned students." });
    const studentIds = assignedStudents.map((student) => Number(student.user_id));
    if (!studentIds.length) return res.json([]);

    const { data: memberships, error: membershipsError } = await supabase.from("group_members")
        .select("group_id,user_id").in("user_id", studentIds);
    if (membershipsError) return res.status(500).json({ success: false, message: "Unable to load assigned student group memberships." });
    const { data: ownedGroups, error: ownedGroupsError } = await supabase.from("groups")
        .select("group_id").in("owner_id", studentIds);
    if (ownedGroupsError) return res.status(500).json({ success: false, message: "Unable to load groups owned by assigned students." });
    const groupIds = [...new Set([
        ...memberships.map((membership) => Number(membership.group_id)),
        ...ownedGroups.map((group) => Number(group.group_id)),
    ])];
    if (!groupIds.length) return res.json([]);

    const [groupsResult, membersResult] = await Promise.all([
        supabase.from("groups").select("group_id,group_name,course,specialty,description,owner_id,status,finalized_at,max_members,created_at").in("group_id", groupIds).order("created_at", { ascending: false }),
        supabase.from("group_members").select("group_id,user_id").in("group_id", groupIds),
    ]);
    if (groupsResult.error || membersResult.error) return res.status(500).json({ success: false, message: "Unable to load assigned student groups." });
    const memberIds = [...new Set(membersResult.data.map((member) => Number(member.user_id)))];
    const usersResult = memberIds.length
        ? await supabase.from("users").select("user_id,name").in("user_id", memberIds)
        : { data: [], error: null };
    if (usersResult.error) return res.status(500).json({ success: false, message: "Unable to load group member names." });
    const names = new Map(usersResult.data.map((record) => [Number(record.user_id), record.name]));
    const membersByGroup = new Map();
    for (const member of membersResult.data) {
        const id = Number(member.group_id);
        membersByGroup.set(id, [...(membersByGroup.get(id) || []), Number(member.user_id)]);
    }
    res.json(groupsResult.data.map((group) => {
        const ids = [...new Set([
            ...(group.owner_id == null ? [] : [Number(group.owner_id)]),
            ...(membersByGroup.get(Number(group.group_id)) || []),
        ])];
        return {
            ...groupDto(group),
            MemberCount: ids.length,
            MemberNames: ids.map((id) => names.get(id)).filter(Boolean).join("|"),
        };
    }));
});

app.patch("/api/adviser/profile", getUser, async (req, res) => {
    if (req.effectiveRole !== "adviser") return res.status(403).json({ success: false, message: "Only advisers can edit adviser details." });
    const bio = String(req.body.bio || "").trim();
    const gender = String(req.body.gender ?? "").trim();
    const requirementRows = Array.isArray(req.body.requirements)
        ? req.body.requirements.map((item) => String(item).trim()).filter(Boolean)
        : String(req.body.requirements || "").split("\n").map((item) => item.trim()).filter(Boolean);
    if (bio.length > 2000 || requirementRows.length > 20 || requirementRows.some((item) => item.length > 250)) {
        return res.status(400).json({ success: false, message: "Bio or requirement text exceeds the allowed limit." });
    }
    if (gender && !["Male", "Female", "Prefer not to say"].includes(gender)) {
        return res.status(400).json({ success: false, message: "Select a valid gender option." });
    }
    const requirements = requirementRows.join("\n");
    const { error } = await supabase.from("users").update({ bio, gender, requirements }).eq("user_id", req.user.user_id).eq("role", "adviser");
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
    const { error: expirationError } = await supabase.rpc("expire_juan_finder_records");
    if (expirationError) return res.status(500).json({ success: false, message: "Unable to refresh expired group requests." });
    const [groupsResult, membersResult, requestsResult, usersResult] = await Promise.all([
        supabase.from("groups").select("*").order("created_at", { ascending: false }),
        supabase.from("group_members").select("group_id,user_id"),
        supabase.from("group_join_requests").select("group_id,user_id,status").eq("status", "Pending").gt("expires_at", new Date().toISOString()),
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
    const { error: expirationError } = await supabase.rpc("expire_juan_finder_records");
    if (expirationError) return res.status(500).json({ success: false, message: "Unable to refresh expired group requests." });
    const [groupsResult, membershipsResult, requestsResult] = await Promise.all([
        supabase.from("groups").select("*").order("created_at", { ascending: false }),
        supabase.from("group_members").select("group_id,user_id").eq("user_id", userId),
        supabase.from("group_join_requests").select("request_id,group_id,user_id,created_at,expires_at").eq("user_id", userId).eq("status", "Pending").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true }),
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
            ? supabase.from("group_join_requests").select("request_id,user_id,created_at,expires_at").eq("group_id", group.group_id).eq("status", "Pending").gt("expires_at", new Date().toISOString()).order("created_at")
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
        pending: pendingResult.data.map((row) => { const user = users.get(Number(row.user_id)); return { RequestID: Number(row.request_id), UserID: Number(row.user_id), Name: user?.name, Username: user?.username, UserCode: user?.user_code, ExpiresAt: row.expires_at }; }),
    } });
});

app.post("/api/groups/:id/requests/:requestId/approve", getUser, requireStudent, async (req, res) => {
    const { error } = await supabase.rpc("approve_group_request", { p_group_id: Number(req.params.id), p_request_id: Number(req.params.requestId), p_owner_id: req.user.user_id });
    if (error) return rpcError(res, error, RPC_MESSAGES);
    res.json({ success: true });
});

app.patch("/api/groups/:id", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    const maxMembers = Number(req.body.maxMembers);
    if (!Number.isInteger(groupId) || !Number.isInteger(maxMembers)) {
        return res.status(400).json({ success: false, message: "Valid group details are required." });
    }
    const { error } = await supabase.rpc("update_owned_group", {
        p_group_id: groupId, p_owner_id: req.user.user_id,
        p_name: String(req.body.name ?? ""), p_description: String(req.body.description ?? ""),
        p_specialty: String(req.body.specialty ?? ""), p_max_members: maxMembers,
    });
    if (error) return rpcError(res, error, {
        ...RPC_MESSAGES,
        "Maximum size cannot be below the current member count": { status: 409, message: "Maximum size cannot be below the current member count." },
        "Group details are invalid": { status: 400, message: "Provide a group name and a member limit from 2 to 4." },
    });
    res.json({ success: true });
});

app.post("/api/groups/:id/finalize", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    if (!Number.isInteger(groupId)) return res.status(400).json({ success: false, message: "A valid group is required." });
    const { error } = await supabase.rpc("finalize_group", { p_group_id: groupId, p_owner_id: req.user.user_id });
    if (error) return rpcError(res, error, RPC_MESSAGES);
    res.json({ success: true });
});

app.delete("/api/groups/:id", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    if (!Number.isInteger(groupId)) return res.status(400).json({ success: false, message: "A valid group is required." });
    const { error } = await supabase.rpc("delete_owned_group", { p_group_id: groupId, p_owner_id: req.user.user_id });
    if (error) return rpcError(res, error, RPC_MESSAGES);
    res.json({ success: true });
});

app.delete("/api/groups/:id/requests/:requestId", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    const requestId = Number(req.params.requestId);
    const { data: group, error: groupError } = await supabase.from("groups").select("owner_id,finalized_at").eq("group_id", groupId).maybeSingle();
    if (groupError) return res.status(500).json({ success: false, message: "Unable to decline request." });
    if (!group || Number(group.owner_id) !== Number(req.user.user_id)) return res.status(403).json({ success: false, message: "Only the group owner can decline requests." });
    if (group.finalized_at) return res.status(409).json({ success: false, message: "This group is finalized and membership is locked." });
    const { data, error } = await supabase.from("group_join_requests").update({ status: "Declined" })
        .eq("group_id", groupId).eq("request_id", requestId).eq("status", "Pending")
        .gt("expires_at", new Date().toISOString()).select("request_id");
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
    if (!Number.isInteger(groupId) || !Number.isInteger(memberId)) return res.status(400).json({ success: false, message: "A valid group and student are required." });
    const { error } = await supabase.rpc("remove_student_from_group", {
        p_group_id: groupId, p_student_id: memberId, p_owner_id: req.user.user_id,
    });
    if (error) return rpcError(res, error, RPC_MESSAGES);
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

app.post("/api/admin/users/:id/temporary-access", getUser, requireAdmin, async (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ success: false, message: "A valid user is required." });
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const characterGroups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*"];
    const passwordCharacters = characterGroups.map((characters) => characters[crypto.randomInt(characters.length)]);
    const allPasswordCharacters = characterGroups.join("");
    while (passwordCharacters.length < 20) passwordCharacters.push(allPasswordCharacters[crypto.randomInt(allPasswordCharacters.length)]);
    for (let index = passwordCharacters.length - 1; index > 0; index -= 1) {
        const swapIndex = crypto.randomInt(index + 1);
        [passwordCharacters[index], passwordCharacters[swapIndex]] = [passwordCharacters[swapIndex], passwordCharacters[index]];
    }
    const temporaryPassword = passwordCharacters.join("");
    const temporaryPasswordHash = await bcrypt.hash(temporaryPassword, 12);
    const { error } = await supabase.rpc("issue_temporary_account", {
        p_user_id: userId,
        p_password_hash: temporaryPasswordHash,
        p_expires_at: expiresAt.toISOString(),
    });
    if (error) return rpcError(res, error, {
        "Only student or adviser accounts may receive temporary access": { status: 400, message: "Temporary access is only available for student and adviser accounts." },
    });
    res.json({ success: true, expiresAt: expiresAt.toISOString(), temporaryPassword, message: "Temporary access issued. Share this password securely; it is shown only once and must be changed at next sign-in." });
});

app.post("/api/admin/users", getUser, requireAdmin, async (req, res) => {
    const { username, userCode, role, password, course, yearLevel, specialty, skills, adviserId, firstName, lastName, expiresAt } = req.body;
    const normalizedRole = ["student", "adviser", "admin", "superadmin"].includes(role) ? role : null;
    if (!normalizedRole) return res.status(400).json({ success: false, message: "A valid user role is required." });

    const trimmedUserCode = String(userCode ?? '').trim();
    const userCodeError = validateUserCode(trimmedUserCode);
    if (userCodeError) return res.status(400).json({ success: false, message: userCodeError });

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ success: false, message: passwordError });
    if (String(password).length < 8 || String(password).length > 128) {
        return res.status(400).json({ success: false, message: "Password must be between 8 and 128 characters." });
    }

    const normalizedFirstName = normalizeNamePart(firstName || req.body.first_name || req.body.firstname);
    const normalizedLastName = normalizeNamePart(lastName || req.body.last_name || req.body.lastname);
    if (!normalizedFirstName || !normalizedLastName) return res.status(400).json({ success: false, message: "First name and last name are required." });

    const generatedUsername = buildGeneratedUsername(normalizedFirstName, normalizedLastName, trimmedUserCode);
    const finalUsername = String(username || generatedUsername).trim();
    if (!finalUsername) return res.status(400).json({ success: false, message: "Username is required." });
    const normalizedExpiresAt = expiresAt ? new Date(expiresAt) : null;
    if (expiresAt && (Number.isNaN(normalizedExpiresAt.getTime()) || normalizedExpiresAt <= new Date())) {
        return res.status(400).json({ success: false, message: "Expiration must be a valid future date and time." });
    }

    const duplicateCheck = await supabase.from("users").select("user_id").or(`user_code.eq.${trimmedUserCode},username.eq.${finalUsername}`);
    if (duplicateCheck.error) return res.status(500).json({ success: false, message: "Unable to validate the user details." });
    if (duplicateCheck.data?.length) return res.status(409).json({ success: false, message: "Username or User ID already exists." });

    const passwordHash = await bcrypt.hash(String(password), 12);
    if (normalizedRole === "student" && adviserId) {
        const { data: adviser, error: adviserError } = await supabase.from("users").select("user_id").eq("user_id", Number(adviserId)).eq("role", "adviser").eq("is_active", true).maybeSingle();
        if (adviserError) return res.status(500).json({ success: false, message: "Unable to verify the selected adviser." });
        if (!adviser) return res.status(400).json({ success: false, message: "Select an active adviser." });
    }
    const { data, error } = await supabase.from("users").insert({
        username: finalUsername, user_code: trimmedUserCode, password_hash: passwordHash,
        first_name: normalizedFirstName, last_name: normalizedLastName,
        name: `${normalizedFirstName} ${normalizedLastName}`.trim(), role: normalizedRole,
        expires_at: normalizedExpiresAt?.toISOString() || null,
        ...(normalizedRole === "student" ? {
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
    const { username, userCode, role, password, firstName, lastName, expiresAt } = req.body;
    const normalizedRole = ["student", "adviser", "admin"].includes(role) ? role : null;
    if (!normalizedRole) return res.status(400).json({ success: false, message: "Username, ID, and role are required." });

    const trimmedUserCode = String(userCode ?? '').trim();
    const userCodeError = validateUserCode(trimmedUserCode);
    if (userCodeError) return res.status(400).json({ success: false, message: userCodeError });

    const normalizedFirstName = normalizeNamePart(firstName || '');
    const normalizedLastName = normalizeNamePart(lastName || '');
    const finalUsername = String(username || buildGeneratedUsername(normalizedFirstName, normalizedLastName, trimmedUserCode)).trim();
    if (!finalUsername) return res.status(400).json({ success: false, message: "Username is required." });

    const passwordError = password ? validatePassword(password) : '';
    if (passwordError) return res.status(400).json({ success: false, message: passwordError });
    if (password && (String(password).length < 8 || String(password).length > 128)) {
        return res.status(400).json({ success: false, message: "Password must be between 8 and 128 characters." });
    }

    const updates = {
        username: finalUsername, user_code: trimmedUserCode, role: normalizedRole,
        first_name: normalizedFirstName, last_name: normalizedLastName,
        name: `${normalizedFirstName || finalUsername} ${normalizedLastName}`.trim() || finalUsername,
    };
    if (Object.prototype.hasOwnProperty.call(req.body, "expiresAt")) {
        const parsedExpiration = expiresAt ? new Date(expiresAt) : null;
        if (expiresAt && (Number.isNaN(parsedExpiration.getTime()) || parsedExpiration <= new Date())) {
            return res.status(400).json({ success: false, message: "Expiration must be a valid future date and time." });
        }
        updates.expires_at = parsedExpiration?.toISOString() || null;
    }
    if (password) updates.password_hash = await bcrypt.hash(String(password), 12);
    const { data, error } = await supabase.from("users").update(updates).eq("user_id", Number(req.params.id)).neq("role", "superadmin").select("user_id");
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ success: false, message: error.code === "23505" ? "Username or ID already exists." : "Unable to edit user." });
    if (!data.length) return res.status(403).json({ success: false, message: "This account cannot be edited." });
    res.json({ success: true });
});

app.patch("/api/admin/users/:id/status", getUser, requireAdmin, async (req, res) => {
    if (req.body.active === true) {
        const { data: user, error: lookupError } = await supabase.from("users").select("expires_at")
            .eq("user_id", Number(req.params.id)).maybeSingle();
        if (lookupError) return res.status(500).json({ success: false, message: "Unable to verify user expiration." });
        if (user?.expires_at && new Date(user.expires_at) <= new Date()) {
            return res.status(409).json({ success: false, message: "Expired accounts cannot be re-enabled. Update the expiration date first." });
        }
    }
    const { error } = await supabase.from("users").update({ is_active: req.body.active === true }).eq("user_id", Number(req.params.id));
    if (error) return res.status(500).json({ success: false, message: "Unable to update user status." });
    if (req.body.active !== true) {
        const { error: sessionError } = await supabase.from("auth_sessions").delete().eq("user_id", Number(req.params.id));
        if (sessionError) return res.status(500).json({ success: false, message: "Account disabled, but existing sessions could not be revoked." });
    }
    res.json({ success: true });
});

app.get("/api/admin/groups", getUser, requireAdmin, async (_req, res) => {
    const [groupsResult, membersResult] = await Promise.all([
        supabase.from("groups").select("group_id,group_name,course,status,max_members,finalized_at").order("group_name"),
        supabase.from("group_members").select("group_id"),
    ]);
    if (groupsResult.error || membersResult.error) return res.status(500).json({ success: false, message: "Unable to load groups." });
    const counts = new Map();
    for (const member of membersResult.data) counts.set(Number(member.group_id), (counts.get(Number(member.group_id)) || 0) + 1);
    res.json(groupsResult.data.map((group) => {
        const memberCount = counts.get(Number(group.group_id)) || 0;
        return { GroupID: Number(group.group_id), GroupName: group.group_name, Course: group.course, Status: group.finalized_at ? "Finalized" : memberCount >= group.max_members ? "Full" : "Open", MaxMembers: group.max_members, MemberCount: memberCount };
    }));
});

app.get("/api/admin/groups/:id/members", getUser, requireAdmin, async (req, res) => {
    const groupId = Number(req.params.id);
    if (!Number.isSafeInteger(groupId) || groupId <= 0) return res.status(400).json({ success: false, message: "Group ID is invalid." });
    const { data: group, error: groupError } = await supabase.from("groups")
        .select("group_id,group_name,course,finalized_at,max_members,owner_id").eq("group_id", groupId).maybeSingle();
    if (groupError) return res.status(500).json({ success: false, message: "Unable to load group details." });
    if (!group) return res.status(404).json({ success: false, message: "Group not found." });
    const [memberResult, studentResult, auditResult, adminResult] = await Promise.all([
        supabase.from("group_members").select("user_id").eq("group_id", groupId),
        supabase.from("users").select("user_id,user_code,first_name,last_name,name").eq("role", "student").eq("is_active", true).order("name"),
        supabase.from("group_membership_audit").select("user_id,admin_id,action,changed_at").eq("group_id", groupId).order("changed_at", { ascending: false }).limit(50),
        supabase.from("users").select("user_id,name,first_name,last_name").in("role", ["admin", "superadmin"]),
    ]);
    if (memberResult.error || studentResult.error || auditResult.error || adminResult.error) {
        return res.status(500).json({ success: false, message: "Unable to load group membership data." });
    }
    const memberIds = new Set(memberResult.data.map((row) => Number(row.user_id)));
    const usersById = new Map(studentResult.data.map((row) => [Number(row.user_id), row]));
    const adminsById = new Map(adminResult.data.map((row) => [Number(row.user_id), row]));
    const toStudentDto = (record) => ({
        UserID: Number(record.user_id), UserCode: record.user_code,
        Name: record.name || [record.first_name, record.last_name].filter(Boolean).join(" "),
    });
    res.json({
        group: { GroupID: Number(group.group_id), GroupName: group.group_name, Finalized: Boolean(group.finalized_at), MaxMembers: group.max_members, OwnerID: Number(group.owner_id) },
        members: studentResult.data.filter((row) => memberIds.has(Number(row.user_id))).map(toStudentDto),
        availableStudents: studentResult.data.filter((row) => !memberIds.has(Number(row.user_id))).map(toStudentDto),
        audit: auditResult.data.map((row) => ({
            Student: usersById.get(Number(row.user_id))?.name || `User ${row.user_id}`,
            Admin: adminsById.get(Number(row.admin_id))?.name || `Admin ${row.admin_id}`,
            Action: row.action, ChangedAt: row.changed_at,
        })),
    });
});

app.post("/api/admin/groups/:id/members", getUser, requireAdmin, async (req, res) => {
    const groupId = Number(req.params.id);
    const studentId = Number(req.body.studentId);
    const action = String(req.body.action ?? "");
    if (!Number.isSafeInteger(groupId) || groupId <= 0 || !Number.isSafeInteger(studentId) || studentId <= 0 || !["add", "remove"].includes(action)) {
        return res.status(400).json({ success: false, message: "A valid group, student, and membership action are required." });
    }
    const { error } = await supabase.rpc("admin_change_finalized_group_member", {
        p_group_id: groupId, p_student_id: studentId, p_admin_id: req.user.user_id, p_action: action,
    });
    if (error) return rpcError(res, error, {
        "Group not found": { status: 404, message: "Group not found." },
        "only for finalized groups": { status: 409, message: "Admin membership changes are only available for finalized groups." },
        "group is full": { status: 409, message: "This group is full." },
        "not in this group": { status: 409, message: "That student is not a member of this group." },
        "cannot be removed": { status: 409, message: "The group leader cannot be removed." },
        "already exists": { status: 409, message: "That student already belongs to a group." },
        "group_members_user_id_unique": { status: 409, message: "That student already belongs to a group." },
        "Only active student accounts": { status: 400, message: "Only active student accounts may be group members." },
        "Admin access is required": { status: 403, message: "Admin access is required." },
    });
    res.json({ success: true });
});

app.delete("/api/admin/groups/:id", getUser, requireAdmin, async (req, res) => {
    const { error } = await supabase.from("groups").delete().eq("group_id", Number(req.params.id));
    if (error) return res.status(500).json({ success: false, message: "Unable to delete group." });
    res.json({ success: true });
});

const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
const AI_SERVICE_TOKEN = process.env.AI_SERVICE_TOKEN || "";
const aiJsonHeaders = { "Content-Type": "application/json" };

async function verifyGroupMembership(groupId, userId) {
    if (!Number.isInteger(groupId) || groupId < 1) return { ok: false, status: 400, message: "A valid group ID is required." };
    const { data, error } = await supabase.from("group_members")
        .select("group_id").eq("group_id", groupId).eq("user_id", userId).maybeSingle();
    if (error) return { ok: false, status: 500, message: "Unable to verify group membership." };
    if (!data) return { ok: false, status: 403, message: "You must be a member of this group to use its AI tools." };
    return { ok: true };
}

async function callAIService(path, options = {}) {
    let response;
    if (path !== "/health" && !AI_SERVICE_TOKEN) {
    const error = new Error(
        "AI_SERVICE_TOKEN is not configured on the backend."
    );
    error.status = 503;
    throw error;
}

    try {
        const headers = {
    ...(options.headers || {}),
    ...(AI_SERVICE_TOKEN
        ? { "x-ai-service-token": AI_SERVICE_TOKEN }
        : {}),
        };
        response = await fetch(`${AI_SERVICE_URL}${path}`, {
            ...options,
            headers,
            signal: AbortSignal.timeout(190000),
        });

    } catch {
        const error = new Error("The AI service is unavailable. Start the local AI service and try again.");
        error.status = 503;
        throw error;
    }
    
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = payload.detail || payload.message || "AI request failed.";
        const error = new Error(String(message));
        error.status = response.status >= 500 ? 503 : response.status;
        throw error;
    }
    return payload;
}

app.get("/api/ai/health", async (_req, res) => {
    try {
        const result = await callAIService("/health", { method: "GET" });
        res.json(result);
    } catch (error) {
        res.status(error.status || 503).json({ success: false, message: error.message });
    }
});

app.post("/api/ai/chat", getUser, async (req, res) => {
    const systemPrompt = req.body?.systemPrompt;
    const messages = req.body?.messages;
    if (typeof systemPrompt !== "string" || !systemPrompt.trim() || systemPrompt.length > 8000) {
        return res.status(400).json({ success: false, message: "A valid AI system prompt is required." });
    }
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 12) {
        return res.status(400).json({ success: false, message: "Send between 1 and 12 chat messages." });
    }
    const validMessages = messages.every(message =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        message.content.trim().length > 0 &&
        message.content.length <= 4000
    );
    if (!validMessages) {
        return res.status(400).json({ success: false, message: "One or more chat messages are invalid." });
    }

    try {
        const result = await callAIService("/chat", {
            method: "POST",
            headers: aiJsonHeaders,
            body: JSON.stringify({
                system_prompt: systemPrompt,
                messages,
            }),
        });
        res.json(result);
    } catch (error) {
        console.error("AI chat error:", error.message);
        res.status(error.status || 503).json({
            success: false,
            message: error.message || "The AI assistant is unavailable.",
        });
    }
});

// The browser sends the original file bytes as application/octet-stream.
// Keep file parsing and model calls behind this API instead of exposing Ollama.
app.post("/api/ai/groups/:groupId/analyze-member", getUser, requireStudent,
    express.raw({ type: "application/octet-stream", limit: "10mb" }),
    async (req, res) => {
        const groupId = Number(req.params.groupId);
        const membership = await verifyGroupMembership(groupId, Number(req.user.user_id));
        if (!membership.ok) return res.status(membership.status).json({ success: false, message: membership.message });

        const filename = String(req.query.filename || "upload.txt").split(/[\\/]/).pop();
        if (!/\\.(pdf|docx|txt)$/i.test(filename)) {
            return res.status(400).json({ success: false, message: "Upload a PDF, DOCX, or TXT file." });
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            return res.status(400).json({ success: false, message: "No file bytes received. Send the file as application/octet-stream." });
        }
        if (req.body.length > 10 * 1024 * 1024) {
            return res.status(413).json({ success: false, message: "File exceeds the 10 MB limit." });
        }

        try {
            const form = new FormData();
            form.append("file", new Blob([req.body]), filename);
            const analyzed = await callAIService("/analyze-member", { method: "POST", body: form });
            const profile = analyzed.member_profile;
            const { error } = await supabase.from("ai_member_profiles").upsert({
                group_id: groupId,
                user_id: req.user.user_id,
                profile_json: profile,
                source_filename: filename,
                updated_at: new Date().toISOString(),
            }, { onConflict: "group_id,user_id" });
            if (error) {
                console.error("AI profile save error:", error.message);
                return res.status(500).json({ success: false, message: "Profile was analyzed but could not be saved. Run server/ai-schema.sql in Supabase." });
            }
            res.json({ success: true, filename, member_profile: profile });
        } catch (error) {
            res.status(error.status || 500).json({ success: false, message: error.message || "Document analysis failed." });
        }
    }
);

app.get("/api/ai/groups/:groupId/profiles", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.groupId);
    const membership = await verifyGroupMembership(groupId, Number(req.user.user_id));
    if (!membership.ok) return res.status(membership.status).json({ success: false, message: membership.message });
    const { data, error } = await supabase.from("ai_member_profiles")
        .select("user_id,profile_json,source_filename,updated_at")
        .eq("group_id", groupId).order("updated_at", { ascending: true });
    if (error) return res.status(500).json({ success: false, message: "Unable to load member profiles. Run server/ai-schema.sql if the AI tables are missing." });
    res.json({ profiles: data.map(row => ({
        user_id: Number(row.user_id), profile: row.profile_json,
        source_filename: row.source_filename, updated_at: row.updated_at,
    })) });
});

app.post("/api/ai/groups/:groupId/generate-titles", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.groupId);
    const membership = await verifyGroupMembership(groupId, Number(req.user.user_id));
    if (!membership.ok) return res.status(membership.status).json({ success: false, message: membership.message });
    const { data, error } = await supabase.from("ai_member_profiles")
        .select("user_id,profile_json").eq("group_id", groupId);
    if (error) return res.status(500).json({ success: false, message: "Unable to load member profiles." });
    if (!data || data.length === 0) return res.status(400).json({ success: false, message: "Upload and analyze at least one member document first." });
    try {
        const result = await callAIService("/generate-titles", {
            method: "POST",
            headers: aiJsonHeaders,
            body: JSON.stringify({ member_profiles: data.map(row => ({ user_id: Number(row.user_id), ...row.profile_json })) }),
        });
        res.json(result);
    } catch (error) {
        res.status(error.status || 500).json({ success: false, message: error.message || "Title generation failed." });
    }
});

app.post("/api/ai/groups/:groupId/select-title", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.groupId);
    const membership = await verifyGroupMembership(groupId, Number(req.user.user_id));
    if (!membership.ok) return res.status(membership.status).json({ success: false, message: membership.message });
    const title = req.body?.title;
    if (!title || typeof title.title !== "string" || !title.title.trim() || title.title.length > 300) {
        return res.status(400).json({ success: false, message: "Provide a valid title object returned by title generation." });
    }
    const { error } = await supabase.from("ai_capstone_projects").upsert({
        group_id: groupId,
        selected_title: title.title.trim(),
        title_details: title,
        created_by: req.user.user_id,
        updated_at: new Date().toISOString(),
    }, { onConflict: "group_id" });
    if (error) return res.status(500).json({ success: false, message: "Unable to save selected title. Run server/ai-schema.sql in Supabase." });
    res.json({ success: true, selected_title: title });
});

app.get("/api/ai/groups/:groupId/selected-title", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.groupId);
    const membership = await verifyGroupMembership(groupId, Number(req.user.user_id));
    if (!membership.ok) return res.status(membership.status).json({ success: false, message: membership.message });
    const { data, error } = await supabase.from("ai_capstone_projects")
        .select("selected_title,title_details,created_at,updated_at")
        .eq("group_id", groupId).maybeSingle();
    if (error) return res.status(500).json({ success: false, message: "Unable to load selected title." });
    res.json({ selected_title: data ? { ...data.title_details, title: data.selected_title, created_at: data.created_at, updated_at: data.updated_at } : null });
});

module.exports = app;
