/**
 * Local content helpers for admin.
 * - Reads: disk first (dev), then bundled import.meta.glob fallbacks.
 * - Writes: DEV-only filesystem apply when GitHub is unavailable.
 */
import type { CommitResult, FileChange } from './github';
import { publicAssetPath } from './content';

const eventModules = import.meta.glob('/src/data/events/*.json', { eager: true });
const execModules = import.meta.glob('/src/data/execs/*.json', { eager: true });

/** Paths only — do not import as ImageMetadata (breaks Workers / @fs redirects). */
const galleryPaths = Object.keys(
	import.meta.glob('/src/assets/gallery/*.{png,jpg,jpeg,webp,gif}')
);

const ALLOWED_WRITE_PREFIXES = [
	'src/data/events/',
	'src/data/execs/',
	'src/assets/events/',
	'src/assets/execs/',
	'src/assets/gallery/',
] as const;

let cachedRoot: string | null = null;

function jsonDefault(mod: unknown): unknown {
	if (mod && typeof mod === 'object' && 'default' in mod) {
		return (mod as { default: unknown }).default;
	}
	return mod;
}

function idFromPath(path: string): string {
	return path.split('/').pop()!.replace(/\.json$/i, '');
}

/** Local filesystem writes are only for `astro dev` / local testing. */
export function isLocalAdminWriteEnabled(): boolean {
	return Boolean(import.meta.env.DEV);
}

function assertSafeRepoPath(path: string): void {
	if (path.includes('..') || path.startsWith('/') || path.includes('\\')) {
		throw new Error(`Unsafe repo path: ${path}`);
	}
	if (!ALLOWED_WRITE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
		throw new Error(`Refusing local write outside content dirs: ${path}`);
	}
}

async function looksLikeWorkspace(root: string): Promise<boolean> {
	const { access } = await import('node:fs/promises');
	const { join } = await import('node:path');
	try {
		await access(join(root, 'wrangler.jsonc'));
		await access(join(root, 'src/data/events'));
		return true;
	} catch {
		return false;
	}
}

async function walkForWorkspace(start: string): Promise<string | null> {
	const { dirname, parse } = await import('node:path');
	let dir = start;
	for (let i = 0; i < 8; i++) {
		if (await looksLikeWorkspace(dir)) return dir;
		const parent = dirname(dir);
		if (parent === dir || parent === parse(dir).root) break;
		dir = parent;
	}
	return null;
}

/**
 * Resolve the git workspace root. Under Cloudflare/vite local Workers,
 * `process.cwd()` is often not the project directory.
 */
async function workspaceRoot(): Promise<string> {
	if (cachedRoot) return cachedRoot;

	const { fileURLToPath } = await import('node:url');
	const seeds: string[] = [];
	try {
		seeds.push(process.cwd());
	} catch {
		/* ignore */
	}
	try {
		// src/lib/admin/local.ts → repo root (when import.meta.url is a real file URL)
		seeds.push(fileURLToPath(new URL('../../..', import.meta.url)));
	} catch {
		/* ignore */
	}
	try {
		seeds.push(fileURLToPath(new URL('.', import.meta.url)));
	} catch {
		/* ignore */
	}

	for (const seed of seeds) {
		const found = await walkForWorkspace(seed);
		if (found) {
			cachedRoot = found;
			return found;
		}
	}

	cachedRoot = seeds[0] ?? '.';
	console.warn('admin local: could not locate workspace root; using', cachedRoot);
	return cachedRoot;
}

async function absRepoPath(repoPath: string): Promise<string> {
	assertSafeRepoPath(repoPath);
	const { join } = await import('node:path');
	return join(await workspaceRoot(), repoPath);
}

function decodeBase64(raw: string): Uint8Array {
	const cleaned = raw.replace(/\n/g, '');
	const binary = atob(cleaned);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function globEvents(): { id: string; data: unknown }[] {
	return Object.entries(eventModules)
		.map(([path, mod]) => ({ id: idFromPath(path), data: jsonDefault(mod) }))
		.sort((a, b) => a.id.localeCompare(b.id));
}

function globExecs(): { id: string; data: unknown }[] {
	return Object.entries(execModules)
		.map(([path, mod]) => ({ id: idFromPath(path), data: jsonDefault(mod) }))
		.sort((a, b) => a.id.localeCompare(b.id));
}

async function listJsonFromDisk(
	dir: string
): Promise<{ id: string; data: unknown }[] | null> {
	try {
		const { readdir, readFile } = await import('node:fs/promises');
		const { join } = await import('node:path');
		const abs = join(await workspaceRoot(), dir);
		const names = await readdir(abs);
		const items: { id: string; data: unknown }[] = [];
		for (const name of names) {
			if (!name.endsWith('.json')) continue;
			const content = await readFile(join(abs, name), 'utf8');
			items.push({ id: name.replace(/\.json$/i, ''), data: JSON.parse(content) });
		}
		return items.sort((a, b) => a.id.localeCompare(b.id));
	} catch {
		return null;
	}
}

export async function listLocalEvents(): Promise<{ id: string; data: unknown }[]> {
	return (await listJsonFromDisk('src/data/events')) ?? globEvents();
}

export async function listLocalExecs(): Promise<{ id: string; data: unknown }[]> {
	return (await listJsonFromDisk('src/data/execs')) ?? globExecs();
}

export async function listLocalDirectory(repoPath: string): Promise<string[]> {
	try {
		const { readdir } = await import('node:fs/promises');
		return await readdir(await absRepoPath(repoPath));
	} catch {
		return [];
	}
}

export async function listLocalGallery(): Promise<{ name: string; path: string }[]> {
	try {
		const { readdir } = await import('node:fs/promises');
		const { join } = await import('node:path');
		const abs = join(await workspaceRoot(), 'src/assets/gallery');
		const names = await readdir(abs);
		return names
			.filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name))
			.map((name) => ({ name, path: publicAssetPath('gallery', name) }))
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return galleryPaths
			.map((path) => {
				const name = path.split('/').pop()!;
				return { name, path: publicAssetPath('gallery', name) };
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	}
}

export async function readLocalTextFile(
	repoPath: string
): Promise<{ sha: string; content: string } | null> {
	try {
		const { readFile } = await import('node:fs/promises');
		const abs = await absRepoPath(repoPath);
		const content = await readFile(abs, 'utf8');
		return { sha: `local-${repoPath}`, content };
	} catch {
		// Bundled fallback for JSON that hasn't been re-read from disk yet.
		const match = repoPath.match(/^src\/data\/(events|execs)\/([^/]+)\.json$/i);
		if (!match) return null;
		const kind = match[1].toLowerCase();
		const id = match[2];
		const items = kind === 'events' ? globEvents() : globExecs();
		const hit = items.find((item) => item.id === id);
		if (!hit) return null;
		return {
			sha: `local-glob-${repoPath}`,
			content: `${JSON.stringify(hit.data, null, 4)}\n`,
		};
	}
}

/** Read a gallery image from the local workspace (dev / nodejs_compat). */
export async function readLocalGalleryFile(name: string): Promise<Uint8Array<ArrayBuffer> | null> {
	try {
		const { readFile } = await import('node:fs/promises');
		const { join } = await import('node:path');
		const bytes = await readFile(join(await workspaceRoot(), 'src/assets/gallery', name));
		return new Uint8Array(bytes);
	} catch {
		return null;
	}
}

/**
 * Apply admin file creates/updates/deletes to the local workspace.
 * DEV-only — used so `/admin` saves work without a GitHub token.
 */
export async function applyLocalFileChanges(
	message: string,
	changes: FileChange[]
): Promise<CommitResult> {
	if (!isLocalAdminWriteEnabled()) {
		throw new Error('Local admin writes are only available in development');
	}
	if (changes.length === 0) {
		throw new Error('No file changes to apply');
	}

	const { mkdir, writeFile, unlink } = await import('node:fs/promises');
	const { dirname } = await import('node:path');

	for (const change of changes) {
		const abs = await absRepoPath(change.path);
		if ('delete' in change && change.delete) {
			try {
				await unlink(abs);
			} catch (err) {
				const code = (err as { code?: string }).code;
				if (code !== 'ENOENT') throw err;
			}
			continue;
		}

		await mkdir(dirname(abs), { recursive: true });
		const encoding = change.encoding ?? 'utf-8';
		if (encoding === 'base64') {
			await writeFile(abs, decodeBase64(change.content));
		} else {
			await writeFile(abs, change.content, 'utf8');
		}
	}

	const sha = `local-${Date.now().toString(16)}`;
	return {
		sha,
		url: '',
		htmlUrl: '',
		message,
	};
}
