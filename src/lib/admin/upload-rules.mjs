/**
 * Server-side image upload rules shared by the Worker API routes and the
 * `astro dev` local-write middleware (scripts/admin-local-write.mjs).
 * Plain JS so Node can import it without a TypeScript loader.
 */

export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 12;
export const MAX_UPLOAD_TOTAL_BYTES = 30 * 1024 * 1024;
/** Base64 inflates ~4/3; leave headroom for JSON fields. */
export const MAX_ADMIN_REQUEST_BYTES = Math.ceil((MAX_UPLOAD_TOTAL_BYTES * 4) / 3) + 1024 * 1024;

/** @type {Record<string, string>} */
const EXTENSION_MIME = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
};

export const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const DATA_URL_RE = /^data:([^;,]*)(?:;[^,]*)?;base64,/i;

/** @param {number} bytes */
export function formatBytes(bytes) {
	return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** @param {string} filename @returns {string | null} */
export function mimeForImageFilename(filename) {
	const ext = filename.split('.').pop()?.toLowerCase() ?? '';
	return EXTENSION_MIME[ext] ?? null;
}

/** @param {string} b64 */
function decodedLength(b64) {
	const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
	return (b64.length / 4) * 3 - padding;
}

/** @param {string} b64 @param {number} byteCount */
function decodePrefix(b64, byteCount) {
	const chars = Math.ceil(byteCount / 3) * 4;
	const binary = atob(b64.slice(0, chars));
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

/**
 * Identify an image by its magic bytes.
 * @param {Uint8Array} b
 * @returns {string | null}
 */
export function sniffImageMime(b) {
	if (
		b.length >= 8 &&
		b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
		b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
	) {
		return 'image/png';
	}
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (
		b.length >= 6 &&
		b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
		(b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61
	) {
		return 'image/gif';
	}
	if (
		b.length >= 12 &&
		b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
		b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
	) {
		return 'image/webp';
	}
	return null;
}

/**
 * Validate one upload's real content (not just its extension).
 * `filename` must already be sanitized to an allowed image extension.
 * @param {string} filename
 * @param {string} rawContent base64, optionally as a `data:<mime>;base64,` URL
 * @returns {{ ok: true; contentBase64: string; mime: string; size: number } | { ok: false; error: string }}
 */
export function validateImageUpload(filename, rawContent) {
	const expectedMime = mimeForImageFilename(filename);
	if (!expectedMime) return { ok: false, error: `Unsupported image type: ${filename}` };

	if (typeof rawContent !== 'string' || !rawContent) {
		return { ok: false, error: `missing contentBase64 for ${filename}` };
	}
	let content = rawContent;
	const dataUrl = content.match(DATA_URL_RE);
	if (dataUrl) {
		const declared = dataUrl[1].toLowerCase();
		if (declared && declared !== expectedMime) {
			return { ok: false, error: `${filename}: declared type ${declared} does not match file extension` };
		}
		content = content.slice(dataUrl[0].length);
	}
	content = content.replace(/\s+/g, '');

	if (!content) return { ok: false, error: `${filename}: file is empty` };
	if (content.length % 4 !== 0 || !BASE64_RE.test(content)) {
		return { ok: false, error: `${filename}: invalid base64 content` };
	}

	const size = decodedLength(content);
	if (size <= 0) return { ok: false, error: `${filename}: file is empty` };
	if (size > MAX_UPLOAD_FILE_BYTES) {
		return {
			ok: false,
			error: `${filename} is ${formatBytes(size)}; max per image is ${formatBytes(MAX_UPLOAD_FILE_BYTES)}`,
		};
	}

	let detected;
	try {
		detected = sniffImageMime(decodePrefix(content, 16));
	} catch {
		return { ok: false, error: `${filename}: invalid base64 content` };
	}
	if (!detected) {
		return { ok: false, error: `${filename} is not a PNG, JPEG, WebP, or GIF image` };
	}
	if (detected !== expectedMime) {
		return {
			ok: false,
			error: `${filename}: content is ${detected} but extension says ${expectedMime}`,
		};
	}

	return { ok: true, contentBase64: content, mime: detected, size };
}

/**
 * @param {{ size: number }[]} files
 * @returns {string | null} error message, or null when within limits
 */
export function validateUploadBatch(files) {
	if (files.length > MAX_UPLOAD_FILES) {
		return `Too many files (${files.length}); max ${MAX_UPLOAD_FILES} per save`;
	}
	const total = files.reduce((sum, f) => sum + f.size, 0);
	if (total > MAX_UPLOAD_TOTAL_BYTES) {
		return `Uploads total ${formatBytes(total)}; max ${formatBytes(MAX_UPLOAD_TOTAL_BYTES)} per save`;
	}
	return null;
}
