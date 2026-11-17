export const prerender = false;

import type { APIRoute } from 'astro';
import {
	EXECS_ASSETS,
	EXECS_DIR,
	applyUploadsToExec,
	errorResponse,
	fileChangesForUploads,
	isValidSlug,
	jsonResponse,
	normalizeExec,
	normalizeUploads,
	prettyJson,
} from '../../../../lib/admin/content';
import { commitFiles, getRepoTextFile, GitHubError, listRepoDirectory } from '../../../../lib/admin/github';
import { listLocalExecs } from '../../../../lib/admin/local';

export const GET: APIRoute = async () => {
	try {
		const entries = await listRepoDirectory(EXECS_DIR);
		const execs = [];

		for (const entry of entries) {
			if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue;
			const id = entry.name.replace(/\.json$/, '');
			const file = await getRepoTextFile(entry.path);
			if (!file) continue;
			execs.push({ id, data: JSON.parse(file.content) });
		}

		execs.sort((a, b) => a.id.localeCompare(b.id));
		return jsonResponse({ execs });
	} catch (err) {
		console.warn('admin execs: GitHub read failed, using local files', err);
		return jsonResponse({ execs: listLocalExecs(), source: 'local' });
	}
};

export const POST: APIRoute = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return errorResponse('Invalid JSON body');
	}

	const raw = body as Record<string, unknown>;
	const id = typeof raw.id === 'string' ? raw.id.trim() : '';
	if (!isValidSlug(id)) return errorResponse('Invalid id (use letters, numbers, &, _, -)');

	const data = normalizeExec(raw.data ?? raw);
	if (typeof data === 'string') return errorResponse(data);

	let takenNames: string[] = [];
	try {
		const entries = await listRepoDirectory(EXECS_ASSETS);
		takenNames = entries.filter((e) => e.type === 'file').map((e) => e.name);
	} catch {
		takenNames = [];
	}

	const files = normalizeUploads(raw.files, { takenNames });
	if (typeof files === 'string') return errorResponse(files);

	const merged = applyUploadsToExec(data, files);

	const jsonPath = `${EXECS_DIR}/${id}.json`;
	const existing = await getRepoTextFile(jsonPath);
	if (existing) return errorResponse(`Exec already exists: ${id}`, 409);

	try {
		const result = await commitFiles(`admin: create exec ${id}`, [
			{ path: jsonPath, content: prettyJson(merged) },
			...fileChangesForUploads('execs', files),
		]);
		return jsonResponse({ ok: true, id, data: merged, commit: result }, 201);
	} catch (err) {
		return githubError(err);
	}
};

function githubError(err: unknown): Response {
	if (err instanceof GitHubError) {
		return errorResponse(err.message, err.status >= 400 && err.status < 600 ? err.status : 502);
	}
	console.error(err);
	return errorResponse('Failed to load or save execs', 500);
}
