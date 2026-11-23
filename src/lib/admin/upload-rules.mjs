/**
 * Image upload rules and naming shared by the Worker API routes and the
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

/** `&` allowed for legacy assets like meet&greet.png */
const IMAGE_NAME_RE = /^[a-z0-9][a-z0-9._&-]*\.(png|jpe?g|webp|gif)$/i;

export const EXEC_PLACEHOLDER = '/assets/execs/placeholder.jpg';

/** @param {string} name */
export function isValidImageFilename(name) {
	return IMAGE_NAME_RE.test(name) && !name.includes('..') && !name.includes('/');
}

/**
 * `LWScreenShot 2026-11-10 at 2.35.00 PM.png` → `lwscreenshot-2026-11-10-at-2-35-00-pm.png`
 * @param {string} name
 */
export function sanitizeImageFilename(name) {
	const base = name.split(/[/\\]/).pop()?.trim() ?? '';
	const m = base.match(/^(.*)\.(png|jpe?g|webp|gif)$/i);
	if (!m) return '';
	const stem = m[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
	const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
	return `${stem || 'image'}.${ext}`;
}

/**
 * Returns `name`, or `name-1`, `name-2`, … if taken; records the result in `taken` (lowercase).
 * @param {string} name
 * @param {Set<string>} taken
 */
export function uniqueImageFilename(name, taken) {
	const dot = name.lastIndexOf('.');
	const stem = name.slice(0, dot);
	const ext = name.slice(dot);
	let candidate = name;
	for (let n = 1; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
	taken.add(candidate.toLowerCase());
	return candidate;
}

/** @typedef {{ filename: string; contentBase64: string }} UploadedFile */

/**
 * Validates an API `files` array; returns sanitized uploads or an error message.
 * @param {unknown} value
 * @returns {UploadedFile[] | string}
 */
export function normalizeUploads(value) {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return 'files must be an array';
	const files = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') return 'invalid files entry';
		if (typeof item.filename !== 'string') return `invalid filename: ${String(item.filename)}`;
		const filename = sanitizeImageFilename(item.filename);
		if (!filename || !isValidImageFilename(filename)) return `invalid filename: ${item.filename}`;
		const checked = validateImageUpload(filename, item.contentBase64);
		if (!checked.ok) return checked.error;
		files.push({ filename, contentBase64: checked.contentBase64, size: checked.size });
	}
	const batchError = validateUploadBatch(files);
	if (batchError) return batchError;
	return files.map(({ filename, contentBase64 }) => ({ filename, contentBase64 }));
}

/**
 * Gives uploads unused names (`photo.jpg` → `photo-1.jpg`) so they never replace existing files.
 * @param {UploadedFile[]} files
 * @param {string[]} existingNames
 */
export function nameUploads(files, existingNames) {
	const taken = new Set(existingNames.map((name) => name.toLowerCase()));
	for (const file of files) file.filename = uniqueImageFilename(file.filename, taken);
}

/**
 * Adds uploaded images to the entry's image list; typed paths are kept as written.
 * @param {'events' | 'execs'} folder
 * @param {{ img?: string; imgs?: { path: string; alt?: string }[] }} data
 * @param {UploadedFile[]} files
 */
export function addUploadedImages(folder, data, files) {
	if (files.length === 0) return;
	const paths = files.map((file) => `/assets/${folder}/${file.filename}`);
	let imgs = data.imgs ?? [];
	// Exec cards show `imgs` instead of `img` when it's non-empty, so keep the current photo in the stack.
	if (folder === 'execs' && imgs.length === 0 && data.img && data.img !== EXEC_PLACEHOLDER) {
		imgs = [{ path: data.img }];
	}
	const listed = new Set(imgs.map((img) => img.path));
	data.imgs = [...imgs, ...paths.filter((path) => !listed.has(path)).map((path) => ({ path }))];
	if (folder === 'execs' && (!data.img || data.img === EXEC_PLACEHOLDER)) data.img = paths[0];
}

/**
 * @param {{ imgs: { path: string; alt?: string }[] }} data
 * @param {UploadedFile[]} files
 * @param {(folder: 'events' | 'gallery') => Promise<string[]>} listNames
 * @returns {Promise<{ path: string; content: string; encoding: 'base64' }[]>}
 */
export async function prepareEventUploads(data, files, listNames) {
	if (files.length === 0) return [];

	const [eventNames, galleryNames] = await Promise.all([listNames('events'), listNames('gallery')]);
	const galleryFiles = files.map((file) => ({ ...file }));
	nameUploads(files, eventNames);
	nameUploads(galleryFiles, galleryNames);
	addUploadedImages('events', data, files);

	return [
		...files.map(({ filename, contentBase64 }) => ({
			path: `src/assets/events/${filename}`,
			content: contentBase64,
			encoding: 'base64',
		})),
		...galleryFiles.map(({ filename, contentBase64 }) => ({
			path: `src/assets/gallery/${filename}`,
			content: contentBase64,
			encoding: 'base64',
		})),
	];
}
