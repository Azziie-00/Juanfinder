const path = require('node:path');
const MAX_APPLICATION_BYTES = 10 * 1024 * 1024;
const fileTypes = new Map([
    ['application/pdf', 'pdf'], ['application/msword', 'doc'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
]);
function invalid(status, message) { throw Object.assign(new Error(message), { status }); }

function parseApplicationFiles(body, validSignature) {
    if (body.requirements !== undefined && body.requirement != null) invalid(400, 'Use a single list of application files.');
    const files = body.requirements !== undefined ? body.requirements : body.requirement != null ? [body.requirement] : [];
    if (!Array.isArray(files)) invalid(400, 'Application files must be a list.');
    if (files.length > 5) invalid(400, 'You can upload at most 5 files.');
    let total = 0;
    return files.map(file => {
        if (!file || typeof file !== 'object') invalid(400, 'Choose valid PDF or Word files.');
        const fileName = path.basename(String(file.fileName ?? '')).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 180);
        const mimeType = String(file.mimeType ?? '').toLowerCase();
        const extension = fileTypes.get(mimeType);
        if (!fileName || !extension) invalid(400, 'Choose PDF, DOC, or DOCX requirements files.');
        const base64 = String(file.data ?? '');
        if (base64.length > Math.ceil(MAX_APPLICATION_BYTES * 4 / 3) + 4) invalid(413, 'Application files must total no more than 10 MB.');
        // Avoid a nested repetition regex: large valid uploads can exhaust its stack.
        if (base64.length % 4 || /[^A-Za-z0-9+/=]/.test(base64)) invalid(400, 'An application file is invalid.');
        const fileBuffer = Buffer.from(base64, 'base64');
        total += fileBuffer.length;
        if (!fileBuffer.length) invalid(400, 'Empty files cannot be uploaded.');
        if (total > MAX_APPLICATION_BYTES) invalid(413, 'Application files must total no more than 10 MB.');
        if (fileBuffer.toString('base64') !== base64) invalid(400, 'An application file is invalid.');
        if (!validSignature(mimeType, fileBuffer)) invalid(415, 'Requirements file content does not match its selected file type.');
        return { fileName, mimeType, extension, fileBuffer };
    });
}
module.exports = { parseApplicationFiles, MAX_APPLICATION_BYTES };
