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
import { getAdminTextFile, persistAdminChanges, persistErrorResponse } from '../../../../lib/admin/persist';

export const GET: APIRoute = async ({ params }) => {
	const id = params.id ?? '';
	if (!isValidSlug(id)) return errorResponse('Invalid id');

	try {
		const file = await getAdminTextFile(`${EVENTS_DIR}/${id}.json`);
		if (!file) return errorResponse('Event not found', 404);
		return jsonResponse({ id, data: JSON.parse(file.content), source: file.source });
	} catch (err) {
		return persistErrorResponse(err, 'Failed to load or save event');
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

	try {
		const existing = await getAdminTextFile(jsonPath);
		if (!existing) return errorResponse('Event not found', 404);

		const result = await persistAdminChanges(`admin: update event ${id}`, [
			{ path: jsonPath, content: prettyJson(data) },
			...fileChangesForUploads('events', files),
		]);
		return jsonResponse({ ok: true, id, data, commit: result, source: result.source });
	} catch (err) {
		return persistErrorResponse(err, 'Failed to load or save event');
	}
};

export const DELETE: APIRoute = async ({ params }) => {
	const id = params.id ?? '';
	if (!isValidSlug(id)) return errorResponse('Invalid id');

	const jsonPath = `${EVENTS_DIR}/${id}.json`;

	try {
		const existing = await getAdminTextFile(jsonPath);
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

		const result = await persistAdminChanges(`admin: delete event ${id}`, changes);
		return jsonResponse({ ok: true, id, commit: result, source: result.source });
	} catch (err) {
		return persistErrorResponse(err, 'Failed to load or save event');
	}
};
