import type { FileChange } from './github';
import { EXEC_PLACEHOLDER } from './upload-rules.mjs';

export {
	EXEC_PLACEHOLDER,
	addUploadedImages,
	isValidImageFilename,
	nameUploads,
	normalizeUploads,
	sanitizeImageFilename,
} from './upload-rules.mjs';

export const EVENTS_DIR = 'src/data/events';
export const EXECS_DIR = 'src/data/execs';
export const EVENTS_ASSETS = 'src/assets/events';
export const EXECS_ASSETS = 'src/assets/execs';
export const GALLERY_ASSETS = 'src/assets/gallery';

const SLUG_RE = /^[a-z0-9][a-z0-9&_-]*$/i;

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
			: EXEC_PLACEHOLDER;

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

function normalizeImgs(value: unknown): ImgRef[] | string {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return 'imgs must be an array';

	const imgs: ImgRef[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') return 'invalid imgs entry';
		const img = item as Record<string, unknown>;
		if (typeof img.path !== 'string' || !img.path.trim()) return 'imgs[].path is required';
		imgs.push({
			path: img.path.trim(),
			alt: typeof img.alt === 'string' ? img.alt : undefined,
		});
	}
	return imgs;
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
		createOnly: true,
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
