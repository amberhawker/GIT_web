import type { FileChange } from './github';

export const EVENTS_DIR = 'src/data/events';
export const EXECS_DIR = 'src/data/execs';
export const EVENTS_ASSETS = 'src/assets/events';
export const EXECS_ASSETS = 'src/assets/execs';
export const GALLERY_ASSETS = 'src/assets/gallery';

const SLUG_RE = /^[a-z0-9][a-z0-9&_-]*$/i;
/** Stored names: letters/digits/._-& — `&` kept for legacy assets like meet&greet.png */
const IMAGE_NAME_RE = /^[a-z0-9][a-z0-9._&-]*\.(png|jpe?g|webp|gif)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;

/** Max decoded upload size (git-backed assets; keep commits lean). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type ImgRef = { path: string; alt?: string };

export type EventData = {
	title: string;
	imgs: ImgRef[];
	description?: string;
	date?: string;
	featured: boolean;
};

export type ExecData = {
	role: string;
	name: string;
	img: string;
	imgs?: ImgRef[];
	degree: string;
	description: string;
};

export type UploadedFile = {
	filename: string;
	contentBase64: string;
};

export function jsonResponse(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

export function errorResponse(message: string, status = 400): Response {
	return Response.json({ error: message }, { status });
}

export function isValidSlug(id: string): boolean {
	return SLUG_RE.test(id) && !id.includes('..') && !id.includes('/');
}

export function isValidImageFilename(name: string): boolean {
	return IMAGE_NAME_RE.test(name) && !name.includes('..') && !name.includes('/');
}

// make filenames more chill
export function sanitizeImageFilename(name: string): string {
	const base = name.split(/[/\\]/).pop()?.trim() ?? '';
	const extMatch = base.match(IMAGE_EXT_RE);
	if (!extMatch) return '';

	let ext = extMatch[0].toLowerCase();
	if (ext === '.jpeg') ext = '.jpg';

	const stem = base
		.slice(0, -extMatch[0].length)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);

	return `${stem || 'image'}${ext}`;
}

/** Avoid overwriting existing assets; case-insensitive collision set. */
export function uniqueImageFilename(name: string, taken: Set<string>): string {
	const lower = name.toLowerCase();
	if (!taken.has(lower)) {
		taken.add(lower);
		return name;
	}

	const extMatch = name.match(IMAGE_EXT_RE);
	if (!extMatch) {
		taken.add(lower);
		return name;
	}

	const ext = extMatch[0];
	const stem = name.slice(0, -ext.length);
	let n = 2;
	let candidate = `${stem}-${n}${ext}`;
	while (taken.has(candidate.toLowerCase())) {
		n += 1;
		candidate = `${stem}-${n}${ext}`;
	}
	taken.add(candidate.toLowerCase());
	return candidate;
}

export function publicAssetPath(folder: 'events' | 'execs' | 'gallery', filename: string): string {
	return `/assets/${folder}/${filename}`;
}

export function repoAssetPath(folder: 'events' | 'execs' | 'gallery', filename: string): string {
	return `src/assets/${folder}/${filename}`;
}

/** Map `/assets/events/foo.png` → `src/assets/events/foo.png` when under our asset roots. */
export function publicPathToRepoPath(publicPath: string): string | null {
	const match = publicPath.match(/^\/assets\/(events|execs|gallery)\/([^/]+)$/);
	if (!match) return null;
	const folder = match[1] as 'events' | 'execs' | 'gallery';
	const filename = match[2];
	if (!isValidImageFilename(filename)) return null;
	return repoAssetPath(folder, filename);
}

export function normalizeEvent(input: unknown): EventData | string {
	if (!input || typeof input !== 'object') return 'Invalid event body';
	const raw = input as Record<string, unknown>;

	if (typeof raw.title !== 'string' || !raw.title.trim()) return 'title is required';

	const imgs = normalizeImgs(raw.imgs);
	if (typeof imgs === 'string') return imgs;

	return {
		title: raw.title.trim(),
		imgs,
		description: optionalString(raw.description),
		date: optionalString(raw.date),
		featured: Boolean(raw.featured),
	};
}

export function normalizeExec(input: unknown): ExecData | string {
	if (!input || typeof input !== 'object') return 'Invalid exec body';
	const raw = input as Record<string, unknown>;

	if (typeof raw.role !== 'string' || !raw.role.trim()) return 'role is required';
	if (typeof raw.name !== 'string' || !raw.name.trim()) return 'name is required';
	if (typeof raw.degree !== 'string') return 'degree is required';
	if (typeof raw.description !== 'string') return 'description is required';

	const img =
		typeof raw.img === 'string' && raw.img.trim()
			? raw.img.trim()
			: '/assets/execs/placeholder.jpg';

	let imgs: ImgRef[] | undefined;
	if (raw.imgs !== undefined) {
		const parsed = normalizeImgs(raw.imgs);
		if (typeof parsed === 'string') return parsed;
		imgs = parsed;
	}

	return {
		role: raw.role.trim(),
		name: raw.name.trim(),
		img,
		imgs,
		degree: raw.degree,
		description: raw.description,
	};
}

function optionalString(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') return undefined;
	return value;
}

function isAllowedAssetPath(path: string): boolean {
	const match = path.match(/^\/assets\/(events|execs|gallery)\/([^/]+)$/);
	if (!match) return false;
	return isValidImageFilename(match[2]);
}

function normalizeImgs(value: unknown): ImgRef[] | string {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return 'imgs must be an array';

	const imgs: ImgRef[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') return 'invalid imgs entry';
		const img = item as Record<string, unknown>;
		if (typeof img.path !== 'string' || !img.path.trim()) return 'imgs[].path is required';
		const path = img.path.trim();
		if (!isAllowedAssetPath(path)) {
			return `imgs[].path must be under /assets/{events|execs|gallery}/ with a valid image name`;
		}
		imgs.push({
			path,
			alt: typeof img.alt === 'string' ? img.alt : undefined,
		});
	}
	return imgs;
}

function approxDecodedBytes(base64: string): number {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** Sniff PNG / JPEG / GIF / WEBP magic bytes from base64 payload. */
function looksLikeImage(base64: string): boolean {
	try {
		const bin = atob(base64.slice(0, 32));
		const b = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);

		if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
		if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
		if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true;
		if (
			b[0] === 0x52 &&
			b[1] === 0x49 &&
			b[2] === 0x46 &&
			b[3] === 0x46 &&
			b[8] === 0x57 &&
			b[9] === 0x45 &&
			b[10] === 0x42 &&
			b[11] === 0x50
		) {
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

export function normalizeUploads(
	value: unknown,
	options?: { takenNames?: Iterable<string> }
): UploadedFile[] | string {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return 'files must be an array';

	const taken = new Set(
		[...(options?.takenNames ?? [])].map((n) => n.toLowerCase())
	);
	const files: UploadedFile[] = [];

	for (const item of value) {
		if (!item || typeof item !== 'object') return 'invalid files entry';
		const file = item as Record<string, unknown>;
		if (typeof file.filename !== 'string') {
			return `invalid filename: ${String(file.filename)}`;
		}

		const sanitized = sanitizeImageFilename(file.filename);
		if (!sanitized || !isValidImageFilename(sanitized)) {
			return `invalid filename: ${file.filename}`;
		}

		if (typeof file.contentBase64 !== 'string' || !file.contentBase64) {
			return `missing contentBase64 for ${file.filename}`;
		}

		const contentBase64 = file.contentBase64.replace(/^data:[^;]+;base64,/, '');
		if (!contentBase64) return `missing contentBase64 for ${file.filename}`;

		const size = approxDecodedBytes(contentBase64);
		if (size > MAX_UPLOAD_BYTES) {
			return `file too large: ${sanitized} (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)`;
		}
		if (!looksLikeImage(contentBase64)) {
			return `file is not a valid image: ${file.filename}`;
		}

		files.push({
			filename: uniqueImageFilename(sanitized, taken),
			contentBase64,
		});
	}
	return files;
}

/** Append uploaded event assets to imgs so saves don't orphan files. */
export function applyUploadsToEvent(data: EventData, files: UploadedFile[]): EventData {
	if (files.length === 0) return data;
	const imgs = [...data.imgs];
	const seen = new Set(imgs.map((img) => img.path));
	for (const file of files) {
		const path = publicAssetPath('events', file.filename);
		if (!seen.has(path)) {
			imgs.push({ path });
			seen.add(path);
		}
	}
	return { ...data, imgs };
}

/** Append uploaded exec assets; set primary img when still on placeholder. */
export function applyUploadsToExec(data: ExecData, files: UploadedFile[]): ExecData {
	if (files.length === 0) return data;
	const imgs = [...(data.imgs ?? [])];
	const seen = new Set(imgs.map((img) => img.path));
	for (const file of files) {
		const path = publicAssetPath('execs', file.filename);
		if (!seen.has(path)) {
			imgs.push({ path });
			seen.add(path);
		}
	}
	const placeholder = !data.img || data.img.includes('placeholder');
	const img = placeholder ? publicAssetPath('execs', files[0].filename) : data.img;
	return { ...data, img, imgs };
}

export function prettyJson(data: unknown): string {
	return `${JSON.stringify(data, null, 4)}\n`;
}

export function fileChangesForUploads(
	folder: 'events' | 'execs' | 'gallery',
	files: UploadedFile[]
): FileChange[] {
	return files.map((file) => ({
		path: repoAssetPath(folder, file.filename),
		content: file.contentBase64,
		encoding: 'base64' as const,
	}));
}

export function assetDeletesFromEntry(data: EventData | ExecData): FileChange[] {
	const paths = new Set<string>();

	if ('img' in data && typeof data.img === 'string') {
		const repo = publicPathToRepoPath(data.img);
		if (repo) paths.add(repo);
	}

	const imgs = 'imgs' in data ? data.imgs : undefined;
	if (imgs) {
		for (const img of imgs) {
			const repo = publicPathToRepoPath(img.path);
			if (repo) paths.add(repo);
		}
	}

	return [...paths].map((path) => ({ path, delete: true as const }));
}
