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
const { parseApplicationFiles } = require("./application-files");
const { createRecommendationHandler } = require("./group-recommendations");
const { createAdviserRecommendationHandler } = require("./adviser-recommendations");

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
    AdviserCapacity: user.role === "adviser" ? Number(user.adviser_capacity ?? 10) : undefined,
    AdviseeCount: Number(user.advisee_count || 0),
});
const groupDto = (group) => ({
    GroupID: Number(group.group_id), GroupName: group.group_name, Course: group.course,
    Specialty: group.specialty, Description: group.description, OwnerID: group.owner_id == null ? null : Number(group.owner_id),
    Status: group.finalized_at ? "Finalized" : group.status, FinalizedAt: group.finalized_at || null,
    AdviserID: group.adviser_id == null ? null : Number(group.adviser_id),
    AdviserAssignedAt: group.adviser_assigned_at || null,
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
    "course": { status: 409, message: "Students can only join groups in their own course." },
    "finalized": { status: 409, message: "This group is finalized and membership is locked." },
};

const USER_ID_PATTERN = /^\d{1,11}$/;
const applicationDocumentDto = document => ({
    DocumentID: Number(document.document_id), FileName: document.file_name, FileType: document.file_type,
    FileSize: Number(document.file_size), UploadedAt: document.created_at,
});
const normalizeCourse = (value) => String(value ?? "").trim().toLocaleLowerCase();
const resolveAccountCourse = async (value) => {
    const { data, error } = await supabase.from("courses").select("course_code");
    if (error) return { error };
    const course = data.find(item => normalizeCourse(item.course_code) === normalizeCourse(value))?.course_code;
    return { course: course && normalizeCourse(course) !== "unspecified" ? course : null };
};
const adviserCoursesMatch = (groupCourse, adviserCourse) => {
    const group = normalizeCourse(groupCourse);
    const adviser = normalizeCourse(adviserCourse);
    return Boolean(group && group !== "unspecified" && adviser && adviser !== "unspecified" && group === adviser);
};
const checkApplicationCourses = async (res, groupId, adviserId) => {
    const [group, adviser] = await Promise.all([
        supabase.from("groups").select("course").eq("group_id", groupId).maybeSingle(),
        supabase.from("advisers").select("course").eq("user_id", adviserId).maybeSingle(),
    ]);
    if (group.error || adviser.error) { adviserWorkflowError(res, group.error || adviser.error); return false; }
    if (!group.data || !adviser.data) { res.status(404).json({ success: false, message: "Group or adviser not found." }); return false; }
    if (!adviserCoursesMatch(group.data.course, adviser.data.course)) {
        res.status(409).json({ success: false, message: "The adviser course must match the group course. Blank or Unspecified courses cannot receive applications." });
        return false;
    }
    return true;
};
const adviserWorkflowError = (res, error) => {
    if (process.env.NODE_ENV !== "production") console.warn("Adviser workflow request failed.", { code: error.code || "unknown" });
    if (["42P01", "42703", "42883", "42501", "PGRST202", "PGRST204", "PGRST205"].includes(error.code)) {
        return res.status(503).json({ success: false, message: "Adviser applications are temporarily unavailable. Please contact an administrator.", repair: "Check server/ADVISER_WORKFLOW.md and apply missing migrations through 013." });
    }
    const message = error.message || "Unable to process this application.";
    const status = /Only |active students/.test(message) ? 403 : /not found/i.test(message) ? 404
        : /already|unavailable|finalized|course|assigned|response is required/i.test(message) || error.code === "23505" ? 409 : 500;
    return res.status(status).json({ success: false, message: status === 500 ? "Unable to process this application. Please try again." : message });
};
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
const getRoleProfile = async (role, userId) => {
    const table = role === "student" ? "students" : role === "adviser" ? "advisers" : null;
    if (!table) return { data: null, error: null };
    return supabase.from(table).select("*").eq("user_id", userId).maybeSingle();
};
const loadUserWithProfile = async (user) => {
    if (!["student", "adviser"].includes(user.role)) return user;
    const { data: profile, error } = await getRoleProfile(user.role, user.user_id);
    if (error) throw error;
    if (!profile) throw new Error(`Missing ${user.role} profile for user ${user.user_id}.`);
    return { ...user, ...profile };
};

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
        req.user = await loadUserWithProfile(data);
        req.sessionHash = sessionHash;
        const previewRole = req.header("x-view-role");
        req.effectiveRole = data.role === "superadmin" && process.env.NODE_ENV !== "production" && ["student", "adviser", "admin", "library"].includes(previewRole)
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

const requireAIAvailable = async (req, res, next) => {
    try {
        const { data, error } = await supabase.from("ai_user_ai_usage")
            .select("status").eq("user_id", req.user.user_id).maybeSingle();
        if (error) {
            console.error("AI usage check failed:", error.message);
            return res.status(503).json({
                success: false,
                message: "AI usage controls are not configured. Run server/ai-user-usage.sql in Supabase, then retry.",
            });
        }
        if (data?.status === "disabled") {
            return res.status(403).json({
                success: false,
                aiDisabled: true,
                message: "Your three personalized capstone titles have already been generated. AI chat and new AI generation are now disabled for this account, but your saved recommendations remain available.",
            });
        }
        if (data?.status === "generating") {
            return res.status(409).json({
                success: false,
                aiGenerating: true,
                message: "Your three capstone titles are being generated. Please wait.",
            });
        }
        next();
    } catch (error) {
        console.error("AI usage middleware error:", error.message);
        res.status(503).json({ success: false, message: "Unable to verify AI access right now." });
    }
};

app.post("/api/login", async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) return res.status(400).json({ success: false, message: "Username, password, and role are required." });
    try {
        const normalizedLogin = String(username).trim();
        const loginName = normalizedLogin.toLowerCase() === "demo" ? `demo.${role}` : normalizedLogin;
        const allowedRoles = role === "admin" ? ["admin", "superadmin"] : role === "library" ? ["library"] : [role];
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
        user = await loadUserWithProfile(user);
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
    const { error } = await supabase.rpc("update_student_profile", {
    p_user_id: req.user.user_id, p_first_name: firstName, p_last_name: lastName, p_name: name,
    p_bio: bio, p_gender: gender, p_socials: socials, p_birthdate: birthdate, p_skills: skills,
    });
    if (error) return res.status(500).json({ success: false, message: "Unable to save your profile." });
    res.json({ success: true, profile: { ...req.user, first_name: firstName, last_name: lastName, name, bio, gender, socials, skills, birthdate } });
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

app.post("/api/advisers/recommendations", getUser, requireStudent,
    createAdviserRecommendationHandler({ supabase, callAIService }));

app.get("/api/advisers", getUser, async (req, res) => {
    const adviserQuery = supabase.from("adviser_slot_availability").select("*").eq("is_active", true).order("name");
    const { data, error } = await adviserQuery;
    if (error) return adviserWorkflowError(res, error);
    const eligibleAdvisers = data.filter((user) =>
        !user.expires_at || new Date(user.expires_at) > new Date()
    );
    res.json(eligibleAdvisers.map((user) => {
        const assignedGroups = Number(user.assigned_groups);
        return {
            UserID: Number(user.user_id), UserCode: user.user_code, Username: user.username,
            Name: user.name, Bio: user.bio, Gender: user.gender, Requirements: user.requirements,
            Course: user.course, Availability: Number(user.adviser_capacity ?? 10), AssignedGroups: assignedGroups,
            HasCapacity: assignedGroups < Number(user.adviser_capacity ?? 10),
            RemainingSlots: Number(user.remaining_slots),
        };
    }));
});

app.get("/api/students", getUser, async (req, res) => {
    let studentQuery = supabase.from("students")
        .select("user_id,course,year_level,specialty,skills,adviser_id");
    if (req.effectiveRole === "adviser") studentQuery = studentQuery.eq("adviser_id", req.user.user_id);
    if (req.effectiveRole === "student") {
        const course = String(req.user.course ?? "").trim();
        if (!course || normalizeCourse(course) === "unspecified") return res.json([]);
        studentQuery = studentQuery.ilike("course", course);
    }
    const [profilesResult, membershipsResult, groupsResult] = await Promise.all([
        studentQuery,
        supabase.from("group_members").select("user_id,group_id"),
        supabase.from("groups").select("group_id,group_name,status,owner_id,finalized_at"),
    ]);
    if (profilesResult.error || membershipsResult.error || groupsResult.error) {
        return res.status(500).json({ success: false, message: "Unable to load students." });
    }
    const profileIds = profilesResult.data.map((profile) => profile.user_id);
    if (!profileIds.length) return res.json([]);
    const [studentsResult, ownerResult] = await Promise.all([
        supabase.from("users").select("user_id,user_code,username,name,is_active").in("user_id", profileIds).eq("is_active", true).order("name"),
        supabase.from("users").select("user_id,name"),
    ]);
    if (studentsResult.error || ownerResult.error) return res.status(500).json({ success: false, message: "Unable to load student identities." });
    const profileById = new Map(profilesResult.data.map((profile) => [Number(profile.user_id), profile]));
    const groupById = new Map(groupsResult.data.map((group) => [Number(group.group_id), group]));
    const groupsByUser = new Map(membershipsResult.data.map((membership) => [Number(membership.user_id), groupById.get(Number(membership.group_id))]));
    const owners = new Map(ownerResult.data.map((owner) => [Number(owner.user_id), owner.name]));
    res.json(studentsResult.data.map((student) => {
        const profile = profileById.get(Number(student.user_id));
        const group = groupsByUser.get(Number(student.user_id));
        return {
            id: String(student.user_id), name: student.name || student.username,
            specialty: profile?.specialty || "Unspecified", group: group?.group_name || "--",
            groupStatus: group?.finalized_at ? "Finalized" : group?.status || null,
            groupLeader: group ? owners.get(Number(group.owner_id)) || "Unassigned" : "",
            availability: group ? "0" : "1",
            year: profile?.year_level || "Unspecified", course: profile?.course || "Unspecified",
            skills: profile?.skills || [], status: group ? "Has a group" : "Looking for group",
            email: student.username,
        };
    }));
});

app.get("/api/adviser/dashboard", getUser, async (req, res) => {
    if (req.effectiveRole !== "adviser" || req.user.role !== "adviser") {
        return res.status(403).json({ success: false, message: "Only advisers can view this dashboard." });
    }
    const search = String(req.query.search ?? "").trim();
    if (search.length > 200) return res.status(400).json({ message: "Search must not exceed 200 characters." });
    const { data, error } = await supabase.rpc("get_adviser_dashboard_report", {
        p_adviser_id: req.user.user_id, p_search: search,
    });
    if (error) {
        console.warn("Adviser dashboard report failed.", { code: error.code || "unknown" });
        return res.status(503).json({ message: "Your adviser dashboard is temporarily unavailable. Please try again or contact an administrator.", repair: "Apply migrations through 014; see server/ADVISER_WORKFLOW.md." });
    }
    if (!data) return res.status(403).json({ message: "An adviser account is required." });
    res.set("Cache-Control", "no-store").json(data);
});

app.get("/api/adviser/groups", getUser, async (req, res) => {
    if (req.effectiveRole !== "adviser") {
        return res.status(403).json({ success: false, message: "Only advisers can view assigned student groups." });
    }
    const { data: assignedGroups, error: assignedError } = await supabase.from("groups")
        .select("group_id").eq("adviser_id", req.user.user_id);
    if (assignedError) return adviserWorkflowError(res, assignedError);
    const groupIds = assignedGroups.map(group => Number(group.group_id));
    if (!groupIds.length) return res.json([]);

    const [groupsResult, membersResult] = await Promise.all([
        supabase.from("groups").select("*").in("group_id", groupIds).order("created_at", { ascending: false }),
        supabase.from("group_members").select("group_id,user_id").in("group_id", groupIds),
    ]);
    if (groupsResult.error || membersResult.error) return res.status(500).json({ success: false, message: "Unable to load assigned student groups." });
    const memberIds = [...new Set([...membersResult.data.map((member) => Number(member.user_id)), ...groupsResult.data.map(group => Number(group.owner_id)).filter(Boolean)])];
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
            Members: ids.map((id) => ({
                UserID: id,
                Name: names.get(id) || "Student",
                IsLeader: id === Number(group.owner_id),
            })),
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
    const { error } = await supabase.from("advisers").update({ bio, gender, requirements }).eq("user_id", req.user.user_id);
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
        const isVisibleToUser = req.effectiveRole !== "student"
            || normalizeCourse(group.course) === normalizeCourse(req.user.course);
        const isGroupListed = req.effectiveRole === "student"
            || group.status === "Open"
            || members.includes(Number(req.user.user_id))
            || pendingSet.has(`${group.group_id}:${req.user.user_id}`);
        return isVisibleToUser && isGroupListed;
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

app.post("/api/groups/recommendations", getUser, requireStudent,
    createRecommendationHandler({ supabase, callAIService }));

app.post("/api/groups/:id/join", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    if (!Number.isInteger(groupId)) return res.status(400).json({ success: false, message: "A valid group is required." });
    const { data: group, error: groupError } = await supabase.from("groups").select("course,finalized_at").eq("group_id", groupId).maybeSingle();
    if (groupError) return res.status(500).json({ success: false, message: "Unable to verify group eligibility." });
    if (!group) return res.status(404).json({ success: false, message: "Group not found." });
    if (normalizeCourse(group.course) !== normalizeCourse(req.user.course)) {
        return res.status(409).json({ success: false, message: "You can only join a group in your course." });
    }
    if (group.finalized_at) return res.status(409).json({ success: false, message: "This group is finalized and membership is locked." });
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
        ...groupDto(group), MembershipStatus: Number(group.owner_id) !== Number(userId) && pendingIds.has(Number(group.group_id)) && !memberships.has(Number(group.group_id)) ? "Pending" : "Member",
        members: membersResult.data.map((row) => { const user = users.get(Number(row.user_id)); return { UserID: Number(row.user_id), Name: user?.name, Role: user?.role }; }),
        pending: pendingResult.data.map((row) => { const user = users.get(Number(row.user_id)); return { RequestID: Number(row.request_id), UserID: Number(row.user_id), Name: user?.name, Username: user?.username, UserCode: user?.user_code, ExpiresAt: row.expires_at }; }),
    } });
});

app.post("/api/groups/:id/requests/:requestId/approve", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    const requestId = Number(req.params.requestId);
    const [groupResult, requestResult] = await Promise.all([
        supabase.from("groups").select("course,finalized_at,owner_id").eq("group_id", groupId).maybeSingle(),
        supabase.from("group_join_requests").select("user_id").eq("group_id", groupId).eq("request_id", requestId).eq("status", "Pending").maybeSingle(),
    ]);
    if (groupResult.error || requestResult.error) return res.status(500).json({ success: false, message: "Unable to verify the join request." });
    if (!groupResult.data || !requestResult.data) return res.status(404).json({ success: false, message: "Join request not found." });
    if (Number(groupResult.data.owner_id) !== Number(req.user.user_id)) return res.status(403).json({ success: false, message: "Only the group owner can approve requests." });
    if (groupResult.data.finalized_at) return res.status(409).json({ success: false, message: "This group is finalized and membership is locked." });
    const { data: student, error: studentError } = await supabase.from("students").select("course").eq("user_id", requestResult.data.user_id).maybeSingle();
    if (studentError) return res.status(500).json({ success: false, message: "Unable to verify student course." });
    if (!student || normalizeCourse(student.course) !== normalizeCourse(groupResult.data.course)) {
        return res.status(409).json({ success: false, message: "Students can only join groups in their own course." });
    }
    const { error } = await supabase.rpc("approve_group_request", { p_group_id: groupId, p_request_id: requestId, p_owner_id: req.user.user_id });
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

app.get("/api/groups/:id/adviser-application", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    if (!Number.isSafeInteger(groupId) || groupId <= 0) return res.status(400).json({ success: false, message: "A valid group is required." });
    const { data, error } = await supabase.rpc("get_group_adviser_application", { p_group_id: groupId, p_user_id: req.user.user_id });
    if (error) return adviserWorkflowError(res, error);
    res.set("Cache-Control", "private, no-store").json(data);
});
app.get("/api/adviser-applications/:id", getUser, requireStudent, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, message: "A valid application is required." });
    const { data, error } = await supabase.rpc("get_adviser_application", { p_application_id: id, p_user_id: req.user.user_id });
    if (error) return adviserWorkflowError(res, error);
    res.set("Cache-Control", "private, no-store").json({ application: data });
});

app.get("/api/notifications", getUser, async (req, res) => {
    const before = req.query.before === undefined ? null : Number(req.query.before);
    if (before !== null && (!Number.isSafeInteger(before) || before <= 0)) return res.status(400).json({ success: false, message: "Invalid notification cursor." });
    const expiry = await supabase.rpc("expire_group_adviser_applications");
    // Inbox reads remain useful if scheduled expiry maintenance temporarily fails.
    if (expiry.error) console.warn("Notification expiry maintenance failed.", { code: expiry.error.code || "network" });
    const { data, error } = await supabase.rpc("get_user_notifications", { p_recipient_id: req.user.user_id, p_before_id: before });
    if (error) return adviserWorkflowError(res, error);
    res.set("Cache-Control", "private, no-store").json(data);
});
app.patch("/api/notifications/read-all", getUser, async (req, res) => {
    const { data, error } = await supabase.rpc("mark_user_notification_read", { p_recipient_id: req.user.user_id, p_notification_id: null });
    if (error) return adviserWorkflowError(res, error);
    res.set("Cache-Control", "private, no-store").json(data);
});
app.patch("/api/notifications/:id/read", getUser, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, message: "A valid notification is required." });
    const { data, error } = await supabase.rpc("mark_user_notification_read", { p_recipient_id: req.user.user_id, p_notification_id: id });
    if (error) return adviserWorkflowError(res, error);
    res.set("Cache-Control", "private, no-store").json(data);
});

app.post("/api/groups/:id/adviser-applications", getUser, requireStudent, async (req, res) => {
    const groupId = Number(req.params.id);
    const adviserId = Number(req.body.adviserId);
    if (!Number.isSafeInteger(groupId) || groupId <= 0 || !Number.isSafeInteger(adviserId) || adviserId <= 0) {
        return res.status(400).json({ success: false, message: "A valid group and adviser are required." });
    }
    // Reject mismatches before uploading files. The RPC repeats this check under row locks.
    if (!await checkApplicationCourses(res, groupId, adviserId)) return;
    let files;
    try { files = parseApplicationFiles(req.body, hasExpectedPortfolioSignature); }
    catch (error) { return res.status(error.status || 400).json({ success: false, message: error.message }); }
    const stagedPaths = [];
    const cleanup = async () => {
        if (!stagedPaths.length) return;
        const { error } = await supabase.storage.from(PORTFOLIO_BUCKET).remove(stagedPaths);
        if (error) console.error("Application file cleanup failed:", error);
    };
    const documents = [];
    try {
        for (const file of files) {
            const storagePath = 'application-requirements/' + req.user.user_id + '/' + crypto.randomUUID() + '.' + file.extension;
            stagedPaths.push(storagePath);
            const { error } = await supabase.storage.from(PORTFOLIO_BUCKET).upload(storagePath, file.fileBuffer, { contentType: file.mimeType, upsert: false });
            if (error) throw error;
            documents.push({ file_name: file.fileName, storage_path: storagePath, file_type: file.mimeType, file_size: file.fileBuffer.length });
        }
    } catch (error) {
        console.error("Application file upload failed:", error);
        await cleanup();
        return res.status(502).json({ success: false, message: "Unable to upload application files. Please try again." });
    }
    const args = { p_group_id: groupId, p_applicant_id: req.user.user_id, p_adviser_id: adviserId };
    if (documents.length) args.p_documents = documents;
    const { data, error } = await supabase.rpc(documents.length ? "submit_group_adviser_application_with_documents" : "submit_group_adviser_application", args);
    if (error) { await cleanup(); return adviserWorkflowError(res, error); }
    const saved = documents.length ? await supabase.from("group_adviser_application_documents")
        .select("document_id,file_name,file_type,file_size,created_at").eq("application_id", Number(data)).order("document_id") : { data: [], error: null };
    if (saved.error) console.error("Saved application file lookup failed:", saved.error);
    // The application is committed: a failed follow-up lookup must not invent an empty list
    // or return a retryable submission failure that could encourage a duplicate upload.
    const requirements = saved.error ? undefined : (saved.data || []).map(applicationDocumentDto);
    const { data: adviser, error: adviserError } = await supabase.from("users").select("name").eq("user_id", adviserId).maybeSingle();
    if (adviserError) console.error("Saved application adviser name lookup failed:", adviserError);
    const details = await supabase.rpc("adviser_application_json", { p_application_id: Number(data) });
    res.status(201).json({ success: true, application: { ApplicationID: Number(data), AdviserID: adviserId, AdviserName: adviser?.name || "", Status: "Pending", ...(details.data || {}), Requirements: requirements, ...(requirements ? { Requirement: requirements[0] || null } : {}) } });
});

app.get("/api/adviser/applications", getUser, async (req, res) => {
    if (req.effectiveRole !== "adviser") return res.status(403).json({ success: false, message: "Only advisers can view adviser applications." });
    const expiry = await supabase.rpc("expire_group_adviser_applications");
    if (expiry.error) return adviserWorkflowError(res, expiry.error);
    const { data: applications, error } = await supabase.from("pending_adviser_applications")
        .select("application_id,group_id,applicant_id,status,created_at,expires_at").eq("adviser_id", req.user.user_id).eq("status", "Pending").order("created_at");
    if (error) return adviserWorkflowError(res, error);
    if (!applications.length) return res.json([]);
    const groupIds = [...new Set(applications.map((item) => Number(item.group_id)))];
    const userIds = [...new Set(applications.map((item) => Number(item.applicant_id)))];
    const [groupsResult, membersResult, usersResult, documentsResult] = await Promise.all([
        supabase.from("groups").select("group_id,group_name,course,owner_id").in("group_id", groupIds),
        supabase.from("group_members").select("group_id,user_id").in("group_id", groupIds),
        supabase.from("users").select("user_id,name").in("user_id", userIds),
        supabase.from("group_adviser_application_documents")
            .select("document_id,application_id,file_name,file_type,file_size,created_at")
            .in("application_id", applications.map((application) => Number(application.application_id))).order("document_id"),
    ]);
    const documentsMigrationMissing = documentsResult.error?.code === "42P01" || documentsResult.error?.code === "PGRST205";
    if (groupsResult.error || membersResult.error || usersResult.error || documentsResult.error) {
        const migrationMissing = documentsMigrationMissing || [groupsResult.error, membersResult.error, usersResult.error]
            .some((error) => error?.code === "42P01" || error?.code === "PGRST205");
        return res.status(migrationMissing ? 503 : 500).json({
            success: false,
            message: migrationMissing
                ? "Adviser application details are not configured. Apply the required database migrations."
                : "Unable to load adviser application details.",
        });
    }
    const groupsById = new Map(groupsResult.data.map((group) => [Number(group.group_id), group]));
    const namesById = new Map(usersResult.data.map((user) => [Number(user.user_id), user.name]));
    const memberIds = [...new Set([...membersResult.data.map((member) => Number(member.user_id)), ...groupsResult.data.map(group => Number(group.owner_id))])];
    const membersResultWithNames = memberIds.length
        ? await supabase.from("users").select("user_id,name").in("user_id", memberIds)
        : { data: [], error: null };
    if (membersResultWithNames.error) return res.status(500).json({ success: false, message: "Unable to load application group members." });
    const memberNames = new Map(membersResultWithNames.data.map((member) => [Number(member.user_id), member.name]));
    const documentsByApplication = new Map();
    for (const document of documentsResult.data) {
        const id = Number(document.application_id);
        documentsByApplication.set(id, [...(documentsByApplication.get(id) || []), applicationDocumentDto(document)]);
    }
    res.json(applications.map((application) => ({
        ApplicationID: Number(application.application_id),
        GroupID: Number(application.group_id),
        GroupName: groupsById.get(Number(application.group_id))?.group_name || "Group",
        Course: groupsById.get(Number(application.group_id))?.course || "",
        Applicant: namesById.get(Number(application.applicant_id)) || "Group leader",
        Members: [...new Set([groupsById.get(Number(application.group_id))?.owner_id,
            ...membersResult.data.filter((member) => Number(member.group_id) === Number(application.group_id)).map(member => member.user_id)])]
            .map(id => memberNames.get(Number(id))).filter(Boolean),
        MemberCount: new Set([groupsById.get(Number(application.group_id))?.owner_id,
            ...membersResult.data.filter(member => Number(member.group_id) === Number(application.group_id)).map(member => member.user_id)]).size,
        Status: application.status,
        CreatedAt: application.created_at,
        ExpiresAt: application.expires_at,
        Requirements: documentsByApplication.get(Number(application.application_id)) || [],
        Requirement: documentsByApplication.get(Number(application.application_id))?.[0] || null,
    })));
});

app.get("/api/adviser/applications/:id", getUser, async (req, res) => {
    if (req.effectiveRole !== "adviser") return res.status(403).json({ success: false, message: "Only advisers can view adviser applications." });
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, message: "A valid application is required." });
    const { data, error } = await supabase.rpc("get_adviser_application_review", { p_application_id: id, p_adviser_id: req.user.user_id });
    if (error) return adviserWorkflowError(res, error);
    res.set("Cache-Control", "private, no-store").json({ application: data });
});

app.get("/api/adviser/applications/:id/requirements/:documentId", getUser, async (req, res) => {
    if (req.effectiveRole !== "adviser") return res.status(403).json({ success: false, message: "Only advisers can access application requirements." });
    const applicationId = Number(req.params.id);
    const documentId = Number(req.params.documentId);
    if (!Number.isSafeInteger(applicationId) || applicationId <= 0 || !Number.isSafeInteger(documentId) || documentId <= 0) {
        return res.status(400).json({ success: false, message: "A valid application document is required." });
    }
    const { data: document, error: documentError } = await supabase.from("group_adviser_application_documents")
        .select("application_id,adviser_id,file_name,file_type,storage_path")
        .eq("document_id", documentId).eq("application_id", applicationId).maybeSingle();
    if (documentError) return res.status(500).json({ success: false, message: "Unable to load the application requirement." });
    if (!document) return res.status(404).json({ success: false, message: "Application requirement not found." });
    if (Number(document.adviser_id) !== Number(req.user.user_id)) {
        return res.status(403).json({ success: false, message: "You cannot access this application requirement." });
    }
    res.set("Cache-Control", "private, no-store");
    const bucket = supabase.storage.from(PORTFOLIO_BUCKET);
    const [view, download] = await Promise.all([
        bucket.createSignedUrl(document.storage_path, 300),
        bucket.createSignedUrl(document.storage_path, 300, { download: document.file_name }),
    ]);
    if (view.error || download.error) return res.status(500).json({ success: false, message: "Unable to open this application file." });
    let text;
    let previewError;
    if (req.query.preview === "text" && document.file_type !== "application/pdf") {
        try {
            const result = await bucket.download(document.storage_path);
            if (result.error) throw result.error;
            const buffer = Buffer.from(await result.data.arrayBuffer());
            const WordExtractor = require("word-extractor");
            const extracted = await new WordExtractor().extract(buffer);
            text = extracted.getBody().slice(0, 500000);
        } catch (error) {
            console.error("Word application preview failed:", error);
            previewError = "This file could not be previewed. Download it to open the original document.";
        }
    }
    res.json({ url: view.data.signedUrl, downloadUrl: download.data.signedUrl, text, previewError });
});

app.post("/api/adviser/applications/:id/respond", getUser, async (req, res) => {
    if (req.effectiveRole !== "adviser") return res.status(403).json({ success: false, message: "Only advisers can respond to applications." });
    const applicationId = Number(req.params.id);
    const action = String(req.body.action ?? "");
    if (!Number.isSafeInteger(applicationId) || applicationId <= 0 || !["accept", "reject"].includes(action)) {
        return res.status(400).json({ success: false, message: "A valid application and response are required." });
    }
    const { data: application, error: applicationError } = await supabase.from("group_adviser_applications")
        .select("group_id,adviser_id,status").eq("application_id", applicationId).maybeSingle();
    if (applicationError) return adviserWorkflowError(res, applicationError);
    if (!application) return res.status(404).json({ success: false, message: "Adviser application not found." });
    if (Number(application.adviser_id) !== Number(req.user.user_id)) return res.status(403).json({ success: false, message: "Only the selected adviser can respond to this application." });
    const expiry = await supabase.rpc("expire_group_adviser_applications", { p_group_id: application.group_id });
    if (expiry.error) return adviserWorkflowError(res, expiry.error);
    if (application.status === "Expired" || (application.status === "Pending" && expiry.data > 0)) return res.status(409).json({ success: false, status: "Expired", message: "This adviser application has expired. The group can apply again." });
    if (action === "accept" && application.status === "Pending" && !await checkApplicationCourses(res, application.group_id, req.user.user_id)) return;
    const { data, error } = await supabase.rpc("respond_to_group_adviser_application", {
        p_application_id: applicationId, p_adviser_id: req.user.user_id, p_accept: action === "accept",
    });
    if (error) return adviserWorkflowError(res, error);
    if (data === "Expired") return res.status(409).json({ success: false, status: "Expired", message: "This adviser application has expired. The group can apply again." });
    res.json({ success: true, status: data });
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
    if (!req.user.course || normalizeCourse(req.user.course) === "unspecified" || normalizeCourse(course) !== normalizeCourse(req.user.course)) {
        return res.status(409).json({ success: false, message: "A group must use the creator's assigned course." });
    }
    const { data: pendingRequest, error: pendingError } = await supabase.from("group_join_requests")
        .select("request_id").eq("user_id", req.user.user_id).eq("status", "Pending")
        .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (pendingError) return res.status(500).json({ success: false, message: "Unable to verify your existing group request." });
    if (pendingRequest) return res.status(409).json({ success: false, message: "Cancel or wait for your pending group request before creating a group." });
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
    const [groupResult, studentResult] = await Promise.all([
        supabase.from("groups").select("course,finalized_at").eq("group_id", groupId).maybeSingle(),
        supabase.from("students").select("course").eq("user_id", memberId).maybeSingle(),
    ]);
    if (groupResult.error || studentResult.error) return res.status(500).json({ success: false, message: "Unable to verify group membership eligibility." });
    if (!groupResult.data || !studentResult.data) return res.status(404).json({ success: false, message: "Group or student not found." });
    if (groupResult.data.finalized_at) return res.status(409).json({ success: false, message: "This group is finalized and membership is locked." });
    if (normalizeCourse(groupResult.data.course) !== normalizeCourse(studentResult.data.course)) {
        return res.status(409).json({ success: false, message: "Students can only join a group in their own course." });
    }
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

const validateAdminCourse = async (course) => {
    const [courseRecord, assignedStudents, assignedAdvisers, assignedGroups] = await Promise.all([
        supabase.from("courses").select("course_code").eq("course_code", course).maybeSingle(),
        supabase.from("students").select("user_id").eq("course", course).limit(1),
        supabase.from("advisers").select("user_id").eq("course", course).limit(1),
        supabase.from("groups").select("group_id").eq("course", course).limit(1),
    ]);
    if (courseRecord.error || assignedStudents.error || assignedAdvisers.error || assignedGroups.error) return { valid: false, error: true };
    return {
        valid: Boolean(courseRecord.data || assignedStudents.data.length || assignedAdvisers.data.length || assignedGroups.data.length),
        error: false,
    };
};

app.get("/api/admin/courses", getUser, requireAdmin, async (_req, res) => {
    const [catalog, assignedStudents, assignedAdvisers, assignedGroups] = await Promise.all([
        supabase.from("courses").select("course_code").order("course_code"),
        supabase.from("students").select("course").neq("course", "").neq("course", "Unspecified"),
        supabase.from("advisers").select("course").neq("course", "").neq("course", "Unspecified"),
        supabase.from("groups").select("course").not("course", "is", null).neq("course", ""),
    ]);
    if (catalog.error || assignedStudents.error || assignedAdvisers.error || assignedGroups.error) return res.status(500).json({ success: false, message: "Unable to load courses." });
    const courses = [
        ...catalog.data.map((row) => row.course_code),
        ...assignedStudents.data.map((row) => row.course),
        ...assignedAdvisers.data.map((row) => row.course),
        ...assignedGroups.data.map((row) => row.course),
    ];
    res.json([...new Set(courses.map((course) => String(course).trim()).filter(Boolean))].sort());
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
    const role = ["student", "adviser", "library"].includes(req.query.role) ? req.query.role : null;
    const course = typeof req.query.course === "string" ? req.query.course.trim() : "";
    if (req.query.course !== undefined && !course) return res.status(400).json({ success: false, message: "Course is invalid." });
    if (course) {
        const validation = await validateAdminCourse(course);
        if (validation.error) return res.status(500).json({ success: false, message: "Unable to validate course filter." });
        if (!validation.valid) return res.status(400).json({ success: false, message: "Course is invalid." });
    }
    let matchingProfileIds = null;
    if (course) {
        const profileTables = role === "student" ? ["students"] : role === "adviser" ? ["advisers"]
            : role === "library" ? [] : ["students", "advisers"];
        const profileResults = await Promise.all(profileTables.map((table) =>
            supabase.from(table).select("user_id").eq("course", course)
        ));
        if (profileResults.some((result) => result.error)) return res.status(500).json({ success: false, message: "Unable to filter users by course." });
        matchingProfileIds = profileResults.flatMap((result) => result.data.map((profile) => profile.user_id));
        if (!matchingProfileIds.length) return res.json({ items: [], total: 0, page, pageSize, totalPages: 0 });
    }
    let query = supabase.from("users").select("*", { count: "exact" }).order("created_at", { ascending: false }).order("user_id", { ascending: false });
    if (role) query = query.eq("role", role);
    if (matchingProfileIds) query = query.in("user_id", matchingProfileIds);
    const { data, count, error } = await query.range(offset, offset + pageSize - 1);
    if (error) return res.status(500).json({ success: false, message: "Unable to load users." });
    const total = count || 0;
    const studentIds = data.filter((record) => record.role === "student").map((record) => record.user_id);
    const adviserIds = data.filter((record) => record.role === "adviser").map((record) => record.user_id);
    const [studentProfiles, adviserProfiles] = await Promise.all([
        studentIds.length ? supabase.from("students").select("*").in("user_id", studentIds) : Promise.resolve({ data: [], error: null }),
        adviserIds.length ? supabase.from("advisers").select("*").in("user_id", adviserIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (studentProfiles.error || adviserProfiles.error) return res.status(500).json({ success: false, message: "Unable to load user profiles." });
    const profileById = new Map([
        ...studentProfiles.data.map((profile) => [Number(profile.user_id), profile]),
        ...adviserProfiles.data.map((profile) => [Number(profile.user_id), profile]),
    ]);
    const adviserCounts = new Map();
    if (role === "adviser" && data.length) {
        const advisees = await supabase.from("students").select("user_id,adviser_id").in("adviser_id", adviserIds);
        if (advisees.error) return res.status(500).json({ success: false, message: "Unable to load adviser advisees." });
        const activeStudents = advisees.data.length
            ? await supabase.from("users").select("user_id").eq("is_active", true).in("user_id", advisees.data.map((row) => row.user_id))
            : { data: [], error: null };
        if (activeStudents.error) return res.status(500).json({ success: false, message: "Unable to verify active adviser advisees." });
        const activeIds = new Set(activeStudents.data.map((row) => Number(row.user_id)));
        for (const advisee of advisees.data) {
            if (activeIds.has(Number(advisee.user_id))) adviserCounts.set(Number(advisee.adviser_id), (adviserCounts.get(Number(advisee.adviser_id)) || 0) + 1);
        }
    }
    res.json({ items: data.map((record) => userDto({
        ...record, ...profileById.get(Number(record.user_id)),
        advisee_count: adviserCounts.get(Number(record.user_id)) || 0,
    })), total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
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
    const normalizedRole = ["student", "adviser", "admin", "superadmin", "library"].includes(role) ? role : null;
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

    let accountCourse = null;
    if (normalizedRole === "adviser" || (normalizedRole === "student" && course)) {
        const result = await resolveAccountCourse(course);
        if (result.error) return res.status(500).json({ success: false, message: "Unable to validate the account course." });
        if (!result.course) return res.status(400).json({ success: false, message: "Select a configured course for this account." });
        accountCourse = result.course;
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
    }).select("*").single();
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ success: false, message: error.code === "23505" ? "Username or ID already exists." : "Unable to add user." });
    if (["student", "adviser"].includes(normalizedRole)) {
        const profile = normalizedRole === "student" ? {
            course: accountCourse || "Unspecified",
            year_level: String(yearLevel || "").trim(),
            specialty: String(specialty || "").trim(),
            skills: Array.isArray(skills) ? skills.map(String) : [],
            adviser_id: adviserId ? Number(adviserId) : null,
        } : { course: accountCourse || "Unspecified" };
        const { data: savedProfile, error: profileError } = await supabase.from(normalizedRole === "student" ? "students" : "advisers")
            .update(profile).eq("user_id", data.user_id).select("*").single();
        if (profileError) {
            const { error: cleanupError } = await supabase.from("users").delete().eq("user_id", data.user_id);
            if (cleanupError) console.error("Account cleanup failed after profile creation error:", cleanupError);
            console.error("Role profile creation failed:", profileError);
            return res.status(500).json({ success: false, message: "Unable to add user profile." });
        }
        return res.status(201).json({ success: true, user: userDto({ ...data, ...savedProfile }) });
    }
    res.status(201).json({ success: true, user: userDto(data) });
});

app.post("/api/admin/library-users", getUser, requireAdmin, async (req, res) => {
    const username = String(req.body.username ?? "").trim().toLowerCase();
    const password = String(req.body.password ?? "");
    if (!/^[a-z0-9][a-z0-9._@+-]{2,119}$/.test(username)) {
        return res.status(400).json({ success: false, message: "Enter a username with 3 to 120 letters, numbers, or . _ @ + - characters." });
    }
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ success: false, message: passwordError });
    if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ success: false, message: "Password must be between 8 and 128 characters." });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const { data, error } = await supabase.from("users").insert({
        username,
        user_code: `LIB-${crypto.randomUUID()}`,
        password_hash: passwordHash,
        name: username,
        first_name: "",
        last_name: "",
        role: "library",
    }).select("*").single();
    if (error) {
        if (error.code === "23505") return res.status(409).json({ success: false, message: "This username is already in use." });
        console.error("Library account creation failed:", error);
        return res.status(500).json({ success: false, message: "Unable to add the library account." });
    }
    res.status(201).json({ success: true, user: userDto(data) });
});

app.delete("/api/admin/users/:id", getUser, requireAdmin, async (req, res) => {
    const { data, error } = await supabase.from("users").delete().eq("user_id", Number(req.params.id)).not("role", "in", "(admin,superadmin)").select("user_id");
    if (error) return res.status(500).json({ success: false, message: "Unable to remove user." });
    if (!data.length) return res.status(403).json({ success: false, message: "Admin accounts cannot be removed." });
    res.json({ success: true });
});

app.patch("/api/admin/users/:id", getUser, requireAdmin, async (req, res) => {
    const { username, userCode, role, password, firstName, lastName, expiresAt, adviserCapacity } = req.body;
    const normalizedRole = ["student", "adviser", "admin", "library"].includes(role) ? role : null;
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
    const profileUpdates = {};
    if (["student", "adviser"].includes(normalizedRole) && Object.prototype.hasOwnProperty.call(req.body, "course")) {
        const result = await resolveAccountCourse(req.body.course);
        if (result.error) return res.status(500).json({ success: false, message: "Unable to validate the account course." });
        if (!result.course) return res.status(400).json({ success: false, message: "Select a configured course for this account." });
        profileUpdates.course = result.course;
    }
    if (normalizedRole === "adviser" && Object.prototype.hasOwnProperty.call(req.body, "adviserCapacity")) {
        const capacityText = String(adviserCapacity);
        const capacity = Number(capacityText);
        if (!/^\d+$/.test(capacityText) || !Number.isSafeInteger(capacity) || capacity < 0 || capacity > 2147483647) {
            return res.status(400).json({ success: false, message: "Adviser slot capacity must be a non-negative whole number." });
        }
        profileUpdates.adviser_capacity = capacity;
    }
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
    if (Object.keys(profileUpdates).length) {
        const table = normalizedRole === "student" ? "students" : normalizedRole === "adviser" ? "advisers" : null;
        if (table) {
            const { error: profileError } = await supabase.from(table).update(profileUpdates).eq("user_id", Number(req.params.id));
            if (profileError) {
                console.error("Role profile update failed:", profileError);
                return res.status(500).json({ success: false, message: "Account saved, but its role profile could not be updated." });
            }
        }
    }
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

app.get("/api/admin/groups", getUser, requireAdmin, async (req, res) => {
    const course = typeof req.query.course === "string" ? req.query.course.trim() : "";
    if (req.query.course !== undefined && !course) return res.status(400).json({ success: false, message: "Course is invalid." });
    if (course) {
        const validation = await validateAdminCourse(course);
        if (validation.error) return res.status(500).json({ success: false, message: "Unable to validate course filter." });
        if (!validation.valid) return res.status(400).json({ success: false, message: "Course is invalid." });
    }
    let groupsQuery = supabase.from("groups").select("group_id,group_name,course,status,max_members,finalized_at").order("group_name");
    if (course) groupsQuery = groupsQuery.eq("course", course);
    const [groupsResult, membersResult] = await Promise.all([
        groupsQuery,
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
        supabase.from("students").select("user_id,course"),
        supabase.from("group_membership_audit").select("user_id,admin_id,action,changed_at").eq("group_id", groupId).order("changed_at", { ascending: false }).limit(50),
        supabase.from("users").select("user_id,name,first_name,last_name").in("role", ["admin", "superadmin"]),
    ]);
    if (memberResult.error || studentResult.error || auditResult.error || adminResult.error) {
        return res.status(500).json({ success: false, message: "Unable to load group membership data." });
    }
    const studentIds = studentResult.data.map((row) => row.user_id);
    const activeStudentResult = studentIds.length
        ? await supabase.from("users").select("user_id,user_code,first_name,last_name,name").eq("is_active", true).in("user_id", studentIds).order("name")
        : { data: [], error: null };
    if (activeStudentResult.error) return res.status(500).json({ success: false, message: "Unable to load student accounts." });
    const profileById = new Map(studentResult.data.map((row) => [Number(row.user_id), row]));
    const memberIds = new Set(memberResult.data.map((row) => Number(row.user_id)));
    const usersById = new Map(activeStudentResult.data.map((row) => [Number(row.user_id), row]));
    const adminsById = new Map(adminResult.data.map((row) => [Number(row.user_id), row]));
    const toStudentDto = (record) => ({
        UserID: Number(record.user_id), UserCode: record.user_code,
        Name: record.name || [record.first_name, record.last_name].filter(Boolean).join(" "),
    });
    res.json({
        group: { GroupID: Number(group.group_id), GroupName: group.group_name, Finalized: Boolean(group.finalized_at), MaxMembers: group.max_members, OwnerID: Number(group.owner_id) },
        members: activeStudentResult.data.filter((row) => memberIds.has(Number(row.user_id))).map(toStudentDto),
        availableStudents: activeStudentResult.data.filter((row) => !memberIds.has(Number(row.user_id)) && normalizeCourse(profileById.get(Number(row.user_id))?.course) === normalizeCourse(group.course)).map(toStudentDto),
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
    if (action === "add") {
        const [groupResult, studentResult] = await Promise.all([
            supabase.from("groups").select("course").eq("group_id", groupId).maybeSingle(),
            supabase.from("students").select("course").eq("user_id", studentId).maybeSingle(),
        ]);
        if (groupResult.error || studentResult.error) return res.status(500).json({ success: false, message: "Unable to verify group course eligibility." });
        if (!groupResult.data || !studentResult.data) return res.status(404).json({ success: false, message: "Group or student not found." });
        if (normalizeCourse(groupResult.data.course) !== normalizeCourse(studentResult.data.course)) {
            return res.status(409).json({ success: false, message: "Students can only join a group in their own course." });
        }
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
    const groupId = Number(req.params.id);
    if (!Number.isSafeInteger(groupId) || groupId <= 0) return res.status(400).json({ success: false, message: "A valid group is required." });
    const { error } = await supabase.rpc("admin_delete_group", { p_group_id: groupId, p_admin_id: req.user.user_id });
    if (error?.code === "PGRST202") return res.status(503).json({ success: false, message: "Group deletion needs an administrator update. Apply migration 009 before retrying." });
    if (error) return rpcError(res, error, {
        "Group not found": { status: 404, message: "Group not found." },
        "Admin access is required": { status: 403, message: "Admin access is required." },
    });
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

app.get("/api/ai/chat/status", getUser, async (req, res) => {
    const { data, error } = await supabase.from("ai_user_ai_usage")
        .select("status,generated_titles,disabled_at")
        .eq("user_id", req.user.user_id).maybeSingle();
    if (error) {
        console.error("AI status lookup failed:", error.message);
        return res.status(503).json({
            success: false,
            message: "AI usage controls are not configured. Run server/ai-user-usage.sql in Supabase.",
        });
    }
    const status = data?.status || "available";
    res.set("Cache-Control", "no-store");
    res.json({
        status,
        ai_disabled: status === "disabled",
        ai_generating: status === "generating",
        titles: Array.isArray(data?.generated_titles) ? data.generated_titles : [],
        disabled_at: data?.disabled_at || null,
    });
});

app.post("/api/ai/chat/analyze-cv", getUser, requireStudent, requireAIAvailable,
    express.raw({ type: "application/octet-stream", limit: "10mb" }),
    async (req, res) => {
        const filename = String(req.query.filename || "cv.txt").split(/[\\/]/).pop();
        if (!/\.(pdf|docx|txt)$/i.test(filename)) {
            return res.status(400).json({ success: false, message: "Upload a PDF, DOCX, or TXT file." });
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            return res.status(400).json({ success: false, message: "No file bytes received." });
        }
        if (req.body.length > 10 * 1024 * 1024) {
            return res.status(413).json({ success: false, message: "File exceeds the 10 MB limit." });
        }

        let generationClaimed = false;
        try {
            const claim = await supabase.rpc("claim_ai_title_generation", {
                p_user_id: req.user.user_id,
            });
            if (claim.error) {
                console.error("AI title quota claim failed:", claim.error.message);
                return res.status(503).json({
                    success: false,
                    message: "AI usage controls are not configured. Run server/ai-user-usage.sql in Supabase.",
                });
            }
            if (claim.data !== true) {
                const current = await supabase.from("ai_user_ai_usage")
                    .select("status").eq("user_id", req.user.user_id).maybeSingle();
                if (current.data?.status === "disabled") {
                    return res.status(403).json({
                        success: false,
                        aiDisabled: true,
                        message: "Your three capstone recommendations have already been generated. AI is disabled for this account.",
                    });
                }
                return res.status(409).json({
                    success: false,
                    message: "Your AI title generation is already in progress. Please wait.",
                });
            }
            generationClaimed = true;

            const form = new FormData();
            form.append("file", new Blob([req.body]), filename);
            form.append("course", String(req.user.course || "Unspecified"));
            const analyzed = await callAIService("/analyze-member", {
                method: "POST",
                body: form,
            });
            if (!analyzed?.member_profile) {
                const error = new Error("The AI did not return a readable CV profile.");
                error.status = 502;
                throw error;
            }

            const generated = await callAIService("/generate-cv-titles", {
                method: "POST",
                headers: aiJsonHeaders,
                body: JSON.stringify({
                    course: String(req.user.course || "Unspecified"),
                    member_profile: analyzed.member_profile,
                }),
            });
            if (!Array.isArray(generated?.titles) || generated.titles.length !== 3) {
                const error = new Error("The AI did not return exactly three title options. Please try again.");
                error.status = 503;
                throw error;
            }

            const completed = await supabase.rpc("complete_ai_title_generation", {
                p_user_id: req.user.user_id,
                p_titles: generated.titles,
            });
            if (completed.error || completed.data !== true) {
                console.error("AI title quota completion failed:", completed.error?.message || "No row was completed.");
                const error = new Error("The titles were generated but could not be saved to your account. Please contact the administrator.");
                error.status = 503;
                throw error;
            }

            generationClaimed = false;
            res.set("Cache-Control", "no-store");
            return res.json({
                success: true,
                filename,
                academic_program: generated.academic_program || analyzed.member_profile.academic_program || req.user.course || "Unspecified",
                member_profile: analyzed.member_profile,
                titles: generated.titles,
                ai_disabled: true,
                message: "Three title recommendations have been saved. AI is now disabled for this account.",
            });
        } catch (error) {
            if (generationClaimed) {
                const release = await supabase.rpc("release_ai_title_generation", {
                    p_user_id: req.user.user_id,
                });
                if (release.error) console.error("AI quota release failed:", release.error.message);
            }
            console.error("CV analysis/title generation error:", error.message);
            return res.status(error.status || 503).json({
                success: false,
                message: error.message || "CV analysis and title generation failed.",
            });
        }
    }
);

app.post("/api/ai/chat", getUser, requireAIAvailable, async (req, res) => {
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
app.post("/api/ai/groups/:groupId/analyze-member", getUser, requireStudent, requireAIAvailable,
    express.raw({ type: "application/octet-stream", limit: "10mb" }),
    async (req, res) => {
        const groupId = Number(req.params.groupId);
        const membership = await verifyGroupMembership(groupId, Number(req.user.user_id));
        if (!membership.ok) return res.status(membership.status).json({ success: false, message: membership.message });

        const filename = String(req.query.filename || "upload.txt").split(/[\\/]/).pop();
        if (!/\.(pdf|docx|txt)$/i.test(filename)) {
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
            form.append("course", String(req.user.course || "Unspecified"));
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

app.post("/api/ai/groups/:groupId/generate-titles", getUser, requireStudent, requireAIAvailable, async (req, res) => {
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

app.use("/api", (_req, res) => {
    res.status(404).json({ success: false, message: "API endpoint not found." });
});

app.use((error, req, res, next) => {
    console.error("Unhandled API request error:", {
        method: req.method,
        path: req.path,
        error: error?.stack || error,
    });
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 500;
    res.status(status).json({
        success: false,
        message: status >= 500 ? "Unable to process this request. Please try again." : "The request could not be processed.",
    });
});

module.exports = app;
