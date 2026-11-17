export const prerender = false;

import type { APIRoute } from 'astro';
import {
	EXECS_ASSETS,
	EXECS_DIR,
	applyUploadsToExec,
	assetDeletesFromEntry,
	errorResponse,
	fileChangesForUploads,
	isValidSlug,
	jsonResponse,
	normalizeExec,
	normalizeUploads,
	prettyJson,
} from '../../../../lib/admin/content';
import { commitFiles, getRepoTextFile, GitHubError, listRepoDirectory } from '../../../../lib/admin/github';

export const GET: APIRoute = async ({ params }) => {
	const id = params.id ?? '';
	if (!isValidSlug(id)) return errorResponse('Invalid id');

	try {
		const file = await getRepoTextFile(`${EXECS_DIR}/${id}.json`);
		if (!file) return errorResponse('Exec not found', 404);
		return jsonResponse({ id, data: JSON.parse(file.content) });
	} catch (err) {
		return githubError(err);
	}
};

export const PUT: APIRoute = async ({ params, request }) => {
	const id = params.id ?? '';
	if (!isValidSlug(id)) return errorResponse('Invalid id');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return errorResponse('Invalid JSON body');
	}

	const raw = body as Record<string, unknown>;
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
	if (!existing) return errorResponse('Exec not found', 404);

	try {
		const result = await commitFiles(`admin: update exec ${id}`, [
			{ path: jsonPath, content: prettyJson(merged) },
			...fileChangesForUploads('execs', files),
		]);
		return jsonResponse({ ok: true, id, data: merged, commit: result });
	} catch (err) {
		return githubError(err);
	}
};

export const DELETE: APIRoute = async ({ params }) => {
	const id = params.id ?? '';
	if (!isValidSlug(id)) return errorResponse('Invalid id');

	const jsonPath = `${EXECS_DIR}/${id}.json`;
	const existing = await getRepoTextFile(jsonPath);
	if (!existing) return errorResponse('Exec not found', 404);

	let data;
	try {
		data = normalizeExec(JSON.parse(existing.content));
	} catch {
		data = null;
	}

	const changes = [
		{ path: jsonPath, delete: true as const },
		...(typeof data === 'object' && data ? assetDeletesFromEntry(data) : []),
	];

	try {
		const result = await commitFiles(`admin: delete exec ${id}`, changes);
		return jsonResponse({ ok: true, id, commit: result });
	} catch (err) {
		return githubError(err);
	}
};

function githubError(err: unknown): Response {
	if (err instanceof GitHubError) {
		return errorResponse(err.message, err.status >= 400 && err.status < 600 ? err.status : 502);
	}
	console.error(err);
	return errorResponse('Failed to load or save exec', 500);
}
