/**
 * Vite Connect middleware (Node): handle `/api/admin` mutations during `astro dev`.
 * Cloudflare's local Worker sandbox cannot write the host workspace (/bundle EPERM).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
	MAX_ADMIN_REQUEST_BYTES,
	validateImageUpload,
	validateUploadBatch,
} from '../src/lib/admin/upload-rules.mjs';

const COOKIE_NAME = 'git_admin_session';
const ALLOWED_PREFIXES = [
	'src/data/events/',
	'src/data/execs/',
	'src/assets/events/',
	'src/assets/execs/',
	'src/assets/gallery/',
];

const SLUG_RE = /^[a-z0-9][a-z0-9&_-]*$/i;
const IMAGE_NAME_RE = /^[a-z0-9][a-z0-9._&-]*\.(png|jpe?g|webp|gif)$/i;

function loadDevVars(root) {
	try {
		const raw = readFileSync(join(root, '.dev.vars'), 'utf8');
		const out = {};
		for (const line of raw.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eq = trimmed.indexOf('=');
			if (eq === -1) continue;
			out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
		}
		return out;
	} catch {
		return {};
	}
}

function fromBase64Url(value) {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
	return Buffer.from(padded + pad, 'base64');
}

function readSessionCookie(cookieHeader) {
	if (!cookieHeader) return undefined;
	const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
	return match?.[1];
}

function isValidSessionToken(secret, token) {
	if (!token) return false;
	const parts = token.split('.');
	if (parts.length !== 2) return false;
	const [payload, signature] = parts;
	if (!payload || !signature) return false;

	const expected = createHmac('sha256', secret).update(payload).digest();
	let actual;
	try {
		actual = fromBase64Url(signature);
	} catch {
		return false;
	}
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

	try {
		const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
		const data = JSON.parse(json);
		return typeof data.exp === 'number' && data.exp > Math.floor(Date.now() / 1000);
	} catch {
		return false;
	}
}

class BodyTooLargeError extends Error {}

async function readBody(req) {
	const declared = Number(req.headers['content-length'] ?? 0);
	if (declared > MAX_ADMIN_REQUEST_BYTES) throw new BodyTooLargeError();
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
		total += buf.length;
		if (total > MAX_ADMIN_REQUEST_BYTES) throw new BodyTooLargeError();
		chunks.push(buf);
	}
	return Buffer.concat(chunks).toString('utf8');
}

/**
 * Ask the local Worker (`/api/admin/session`) whether the cookie's session is still
 * active in KV, so revoked sessions are rejected here too.
 */
async function isSessionActiveInWorker(req) {
	// Use the socket this server accepted the request on, never the client-controlled Host header.
	const { localAddress, localPort } = req.socket ?? {};
	if (!localAddress || !localPort) return false;
	const address = localAddress.startsWith('::ffff:') ? localAddress.slice(7) : localAddress;
	const host = address.includes(':') ? `[${address}]` : address;
	try {
		const res = await fetch(`http://${host}:${localPort}/api/admin/session`, {
			headers: { cookie: req.headers.cookie ?? '' },
		});
		if (!res.ok) return false;
		const data = await res.json();
		return data?.authenticated === true;
	} catch {
		return false;
	}
}

function sendJson(res, status, data) {
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(data));
}

function isAdminMutation(method, pathname) {
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
	return (
		pathname === '/api/admin/events' ||
		pathname.startsWith('/api/admin/events/') ||
		pathname === '/api/admin/execs' ||
		pathname.startsWith('/api/admin/execs/') ||
		pathname === '/api/admin/gallery' ||
		pathname.startsWith('/api/admin/gallery/')
	);
}

function assertSafePath(path) {
	if (path.includes('..') || path.startsWith('/') || path.includes('\\')) {
		throw new Error(`Unsafe path: ${path}`);
	}
	if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
		throw new Error(`Refusing write outside content dirs: ${path}`);
	}
}

function abs(root, repoPath) {
	assertSafePath(repoPath);
	return join(root, repoPath);
}

async function applyChanges(root, message, changes) {
	for (const change of changes) {
		const filePath = abs(root, change.path);
		if (change.delete) {
			try {
				await unlink(filePath);
			} catch (err) {
				if (err?.code !== 'ENOENT') throw err;
			}
			continue;
		}
		await mkdir(dirname(filePath), { recursive: true });
		if (change.encoding === 'base64') {
			await writeFile(filePath, Buffer.from(change.content.replace(/\n/g, ''), 'base64'));
		} else {
			await writeFile(filePath, change.content, 'utf8');
		}
	}
	return {
		sha: `local-${Date.now().toString(16)}`,
		url: '',
		htmlUrl: '',
		message,
		source: 'local',
	};
}

function prettyJson(data) {
	return `${JSON.stringify(data, null, 4)}\n`;
}

function sanitizeImageFilename(name) {
	const base = name.split(/[/\\]/).pop()?.trim() ?? '';
	const m = base.match(/^(.*)\.(png|jpe?g|webp|gif)$/i);
	if (!m) return '';
	const stem = m[1]
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
	return `${stem || 'image'}.${ext}`;
}

function normalizeUploads(value) {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return 'files must be an array';
	const files = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') return 'invalid files entry';
		if (typeof item.filename !== 'string') return `invalid filename: ${String(item.filename)}`;
		const filename = sanitizeImageFilename(item.filename);
		if (!filename || !IMAGE_NAME_RE.test(filename)) return `invalid filename: ${item.filename}`;
		const checked = validateImageUpload(filename, item.contentBase64);
		if (!checked.ok) return checked.error;
		files.push({ filename, contentBase64: checked.contentBase64, size: checked.size });
	}
	const batchError = validateUploadBatch(files);
	if (batchError) return batchError;
	return files.map(({ filename, contentBase64 }) => ({ filename, contentBase64 }));
}

function normalizeImgs(value) {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return 'imgs must be an array';
	const imgs = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') return 'invalid imgs entry';
		if (typeof item.path !== 'string' || !item.path.trim()) return 'imgs[].path is required';
		imgs.push({
			path: item.path.trim(),
			alt: typeof item.alt === 'string' ? item.alt : undefined,
		});
	}
	return imgs;
}

function normalizeEvent(input) {
	if (!input || typeof input !== 'object') return 'Invalid event body';
	if (typeof input.title !== 'string' || !input.title.trim()) return 'title is required';
	const imgs = normalizeImgs(input.imgs);
	if (typeof imgs === 'string') return imgs;
	return {
		title: input.title.trim(),
		imgs,
		description: typeof input.description === 'string' ? input.description : undefined,
		date: typeof input.date === 'string' ? input.date : undefined,
		featured: Boolean(input.featured),
	};
}

function normalizeExec(input) {
	if (!input || typeof input !== 'object') return 'Invalid exec body';
	if (typeof input.role !== 'string' || !input.role.trim()) return 'role is required';
	if (typeof input.name !== 'string' || !input.name.trim()) return 'name is required';
	if (typeof input.degree !== 'string') return 'degree is required';
	if (typeof input.description !== 'string') return 'description is required';
	const img =
		typeof input.img === 'string' && input.img.trim()
			? input.img.trim()
			: '/assets/execs/placeholder.jpg';
	let imgs;
	if (input.imgs !== undefined) {
		const parsed = normalizeImgs(input.imgs);
		if (typeof parsed === 'string') return parsed;
		imgs = parsed;
	}
	return {
		role: input.role.trim(),
		name: input.name.trim(),
		img,
		imgs,
		degree: input.degree,
		description: input.description,
	};
}

function uploadChanges(folder, files) {
	return files.map((file) => ({
		path: `src/assets/${folder}/${file.filename}`,
		content: file.contentBase64,
		encoding: 'base64',
	}));
}

function publicPathToRepoPath(publicPath) {
	const match = publicPath.match(/^\/assets\/(events|execs|gallery)\/([^/]+)$/);
	if (!match) return null;
	const filename = match[2];
	if (!IMAGE_NAME_RE.test(filename)) return null;
	return `src/assets/${match[1]}/${filename}`;
}

function assetDeletesFromEntry(data) {
	const paths = new Set();
	if (typeof data.img === 'string') {
		const repo = publicPathToRepoPath(data.img);
		if (repo) paths.add(repo);
	}
	for (const img of data.imgs ?? []) {
		const repo = publicPathToRepoPath(img.path);
		if (repo) paths.add(repo);
	}
	return [...paths].map((path) => ({ path, delete: true }));
}

async function readJsonFile(root, repoPath) {
	try {
		return await readFile(abs(root, repoPath), 'utf8');
	} catch {
		return null;
	}
}

async function handle(root, req, res) {
	const method = (req.method ?? 'GET').toUpperCase();
	const pathname = (req.url ?? '/').split('?')[0] ?? '/';
	if (!isAdminMutation(method, pathname)) return false;

	const vars = loadDevVars(root);
	const secret = vars.SESSION_SECRET;
	if (!secret) {
		sendJson(res, 500, { error: 'Missing SESSION_SECRET in .dev.vars' });
		return true;
	}
	if (
		!isValidSessionToken(secret, readSessionCookie(req.headers.cookie ?? null)) ||
		!(await isSessionActiveInWorker(req))
	) {
		sendJson(res, 401, { error: 'Unauthorized' });
		return true;
	}

	let body = {};
	if (method !== 'DELETE') {
		try {
			body = JSON.parse(await readBody(req) || '{}');
		} catch (err) {
			if (err instanceof BodyTooLargeError) {
				sendJson(res, 413, { error: 'Request body too large' });
			} else {
				sendJson(res, 400, { error: 'Invalid JSON body' });
			}
			return true;
		}
	}

	try {
		if (pathname === '/api/admin/events' && method === 'POST') {
			const id = typeof body.id === 'string' ? body.id.trim() : '';
			if (!SLUG_RE.test(id)) {
				sendJson(res, 400, { error: 'Invalid id (use letters, numbers, &, _, -)' });
				return true;
			}
			const data = normalizeEvent(body.data ?? body);
			if (typeof data === 'string') {
				sendJson(res, 400, { error: data });
				return true;
			}
			const files = normalizeUploads(body.files);
			if (typeof files === 'string') {
				sendJson(res, 400, { error: files });
				return true;
			}
			const jsonPath = `src/data/events/${id}.json`;
			if (await readJsonFile(root, jsonPath)) {
				sendJson(res, 409, { error: `Event already exists: ${id}` });
				return true;
			}
			const commit = await applyChanges(root, `admin: create event ${id}`, [
				{ path: jsonPath, content: prettyJson(data) },
				...uploadChanges('events', files),
			]);
			sendJson(res, 201, { ok: true, id, data, commit, source: 'local' });
			return true;
		}

		const eventMatch = pathname.match(/^\/api\/admin\/events\/([^/]+)$/);
		if (eventMatch) {
			const id = decodeURIComponent(eventMatch[1]);
			if (!SLUG_RE.test(id)) {
				sendJson(res, 400, { error: 'Invalid id' });
				return true;
			}
			const jsonPath = `src/data/events/${id}.json`;
			if (method === 'PUT') {
				const data = normalizeEvent(body.data ?? body);
				if (typeof data === 'string') {
					sendJson(res, 400, { error: data });
					return true;
				}
				const files = normalizeUploads(body.files);
				if (typeof files === 'string') {
					sendJson(res, 400, { error: files });
					return true;
				}
				if (!(await readJsonFile(root, jsonPath))) {
					sendJson(res, 404, { error: 'Event not found' });
					return true;
				}
				const commit = await applyChanges(root, `admin: update event ${id}`, [
					{ path: jsonPath, content: prettyJson(data) },
					...uploadChanges('events', files),
				]);
				sendJson(res, 200, { ok: true, id, data, commit, source: 'local' });
				return true;
			}
			if (method === 'DELETE') {
				const existing = await readJsonFile(root, jsonPath);
				if (!existing) {
					sendJson(res, 404, { error: 'Event not found' });
					return true;
				}
				let data = null;
				try {
					data = normalizeEvent(JSON.parse(existing));
					if (typeof data === 'string') data = null;
				} catch {
					data = null;
				}
				const commit = await applyChanges(root, `admin: delete event ${id}`, [
					{ path: jsonPath, delete: true },
					...(data ? assetDeletesFromEntry(data) : []),
				]);
				sendJson(res, 200, { ok: true, id, commit, source: 'local' });
				return true;
			}
		}

		if (pathname === '/api/admin/execs' && method === 'POST') {
			const id = typeof body.id === 'string' ? body.id.trim() : '';
			if (!SLUG_RE.test(id)) {
				sendJson(res, 400, { error: 'Invalid id (use letters, numbers, &, _, -)' });
				return true;
			}
			const data = normalizeExec(body.data ?? body);
			if (typeof data === 'string') {
				sendJson(res, 400, { error: data });
				return true;
			}
			const files = normalizeUploads(body.files);
			if (typeof files === 'string') {
				sendJson(res, 400, { error: files });
				return true;
			}
			const jsonPath = `src/data/execs/${id}.json`;
			if (await readJsonFile(root, jsonPath)) {
				sendJson(res, 409, { error: `Exec already exists: ${id}` });
				return true;
			}
			const commit = await applyChanges(root, `admin: create exec ${id}`, [
				{ path: jsonPath, content: prettyJson(data) },
				...uploadChanges('execs', files),
			]);
			sendJson(res, 201, { ok: true, id, data, commit, source: 'local' });
			return true;
		}

		const execMatch = pathname.match(/^\/api\/admin\/execs\/([^/]+)$/);
		if (execMatch) {
			const id = decodeURIComponent(execMatch[1]);
			if (!SLUG_RE.test(id)) {
				sendJson(res, 400, { error: 'Invalid id' });
				return true;
			}
			const jsonPath = `src/data/execs/${id}.json`;
			if (method === 'PUT') {
				const data = normalizeExec(body.data ?? body);
				if (typeof data === 'string') {
					sendJson(res, 400, { error: data });
					return true;
				}
				const files = normalizeUploads(body.files);
				if (typeof files === 'string') {
					sendJson(res, 400, { error: files });
					return true;
				}
				if (!(await readJsonFile(root, jsonPath))) {
					sendJson(res, 404, { error: 'Exec not found' });
					return true;
				}
				const commit = await applyChanges(root, `admin: update exec ${id}`, [
					{ path: jsonPath, content: prettyJson(data) },
					...uploadChanges('execs', files),
				]);
				sendJson(res, 200, { ok: true, id, data, commit, source: 'local' });
				return true;
			}
			if (method === 'DELETE') {
				const existing = await readJsonFile(root, jsonPath);
				if (!existing) {
					sendJson(res, 404, { error: 'Exec not found' });
					return true;
				}
				let data = null;
				try {
					data = normalizeExec(JSON.parse(existing));
					if (typeof data === 'string') data = null;
				} catch {
					data = null;
				}
				const commit = await applyChanges(root, `admin: delete exec ${id}`, [
					{ path: jsonPath, delete: true },
					...(data ? assetDeletesFromEntry(data) : []),
				]);
				sendJson(res, 200, { ok: true, id, commit, source: 'local' });
				return true;
			}
		}

		if (pathname === '/api/admin/gallery' && method === 'POST') {
			const filesInput =
				body.files ??
				(typeof body.filename === 'string'
					? [{ filename: body.filename, contentBase64: body.contentBase64 }]
					: undefined);
			const files = normalizeUploads(filesInput);
			if (typeof files === 'string') {
				sendJson(res, 400, { error: files });
				return true;
			}
			if (files.length === 0) {
				sendJson(res, 400, { error: 'No files to upload' });
				return true;
			}
			const commit = await applyChanges(
				root,
				files.length === 1
					? `admin: add gallery image ${files[0].filename}`
					: `admin: add ${files.length} gallery images`,
				uploadChanges('gallery', files)
			);
			sendJson(res, 201, {
				ok: true,
				images: files.map((f) => ({
					name: f.filename,
					path: `/assets/gallery/${f.filename}`,
				})),
				commit,
				source: 'local',
			});
			return true;
		}

		const galleryMatch = pathname.match(/^\/api\/admin\/gallery\/([^/]+)$/);
		if (galleryMatch && method === 'DELETE') {
			const name = decodeURIComponent(galleryMatch[1]);
			if (!IMAGE_NAME_RE.test(name)) {
				sendJson(res, 400, { error: 'Invalid image name' });
				return true;
			}
			const names = await readdir(join(root, 'src/assets/gallery')).catch(() => []);
			if (!names.includes(name)) {
				sendJson(res, 404, { error: 'Image not found' });
				return true;
			}
			const commit = await applyChanges(root, `admin: delete gallery image ${name}`, [
				{ path: `src/assets/gallery/${name}`, delete: true },
			]);
			sendJson(res, 200, { ok: true, name, commit, source: 'local' });
			return true;
		}

		sendJson(res, 405, { error: 'Method not allowed' });
		return true;
	} catch (err) {
		console.error('admin local write failed', err);
		sendJson(res, 500, { error: err instanceof Error ? err.message : 'Local save failed' });
		return true;
	}
}

/** Create Vite Connect middleware bound to the project root. */
export function createAdminLocalWriteMiddleware(root) {
	return async function adminLocalWriteMiddleware(req, res, next) {
		try {
			const handled = await handle(root, req, res);
			if (!handled) next();
		} catch (err) {
			next(err);
		}
	};
}
