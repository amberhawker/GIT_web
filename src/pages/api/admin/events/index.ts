export const prerender = false;

import type { APIRoute } from 'astro';
import {
	EVENTS_DIR,
	errorResponse,
	fileChangesForUploads,
	isValidSlug,
	jsonResponse,
	normalizeEvent,
	normalizeUploads,
	prettyJson,
} from '../../../../lib/admin/content';
import { getRepoTextFile, listRepoDirectory } from '../../../../lib/admin/github';
import { listLocalEvents } from '../../../../lib/admin/local';
import { getAdminTextFile, persistAdminChanges, persistErrorResponse } from '../../../../lib/admin/persist';

export const GET: APIRoute = async () => {
	try {
		const entries = await listRepoDirectory(EVENTS_DIR);
		const events = [];

		for (const entry of entries) {
			if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue;
			const id = entry.name.replace(/\.json$/, '');
			const file = await getRepoTextFile(entry.path);
			if (!file) continue;
			events.push({ id, data: JSON.parse(file.content) });
		}

		events.sort((a, b) => a.id.localeCompare(b.id));
		return jsonResponse({ events });
	} catch (err) {
		console.warn('admin events: GitHub read failed, using local files', err);
		return jsonResponse({ events: await listLocalEvents(), source: 'local' });
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

	const data = normalizeEvent(raw.data ?? raw);
	if (typeof data === 'string') return errorResponse(data);

	const files = normalizeUploads(raw.files);
	if (typeof files === 'string') return errorResponse(files);

	const jsonPath = `${EVENTS_DIR}/${id}.json`;

	try {
		const existing = await getAdminTextFile(jsonPath);
		if (existing) return errorResponse(`Event already exists: ${id}`, 409);

		const result = await persistAdminChanges(`admin: create event ${id}`, [
			{ path: jsonPath, content: prettyJson(data) },
			...fileChangesForUploads('events', files),
		]);
		return jsonResponse({ ok: true, id, data, commit: result, source: result.source }, 201);
	} catch (err) {
		return persistErrorResponse(err, 'Failed to load or save events');
	}
};
