export const prerender = false;

import type { APIRoute } from 'astro';
import {
	EVENTS_DIR,
	assetDeletesFromEntry,
	errorResponse,
	fileChangesForUploads,
	isValidSlug,
	jsonResponse,
	normalizeEvent,
	normalizeUploads,
	prettyJson,
} from '../../../../lib/admin/content';
import { commitFiles, getRepoTextFile, GitHubError } from '../../../../lib/admin/github';

export const GET: APIRoute = async ({ params }) => {
	const id = params.id ?? '';
	if (!isValidSlug(id)) return errorResponse('Invalid id');

	try {
		const file = await getRepoTextFile(`${EVENTS_DIR}/${id}.json`);
		if (!file) return errorResponse('Event not found', 404);
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
	const data = normalizeEvent(raw.data ?? raw);
	if (typeof data === 'string') return errorResponse(data);

	const files = normalizeUploads(raw.files);
	if (typeof files === 'string') return errorResponse(files);

	const jsonPath = `${EVENTS_DIR}/${id}.json`;
	const existing = await getRepoTextFile(jsonPath);
	if (!existing) return errorResponse('Event not found', 404);

	try {
		const result = await commitFiles(`admin: update event ${id}`, [
			{ path: jsonPath, content: prettyJson(data) },
			...fileChangesForUploads('events', files),
		]);
		return jsonResponse({ ok: true, id, data, commit: result });
	} catch (err) {
		return githubError(err);
	}
};

export const DELETE: APIRoute = async ({ params }) => {
	const id = params.id ?? '';
	if (!isValidSlug(id)) return errorResponse('Invalid id');

	const jsonPath = `${EVENTS_DIR}/${id}.json`;
	const existing = await getRepoTextFile(jsonPath);
	if (!existing) return errorResponse('Event not found', 404);

	let data;
	try {
		data = normalizeEvent(JSON.parse(existing.content));
	} catch {
		data = null;
	}

	const changes = [
		{ path: jsonPath, delete: true as const },
		...(typeof data === 'object' && data ? assetDeletesFromEntry(data) : []),
	];

	try {
		const result = await commitFiles(`admin: delete event ${id}`, changes);
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
	return errorResponse('Failed to load or save event', 500);
}
