export const prerender = false;

import type { APIRoute } from 'astro';
import {
	EXECS_DIR,
	assetDeletesFromEntry,
	errorResponse,
	fileChangesForUploads,
	isValidSlug,
	jsonResponse,
	normalizeExec,
	normalizeUploads,
	EXECS_ASSETS,
	addUploadedImages,
	nameUploads,
	prettyJson,
} from '../../../../lib/admin/content';
import {
	getAdminTextFile,
	listAdminAssetNames,
	persistAdminChanges,
	persistErrorResponse,
} from '../../../../lib/admin/persist';

export const GET: APIRoute = async ({ params }) => {
	const id = params.id ?? '';
	if (!isValidSlug(id)) return errorResponse('Invalid id');

	try {
		const file = await getAdminTextFile(`${EXECS_DIR}/${id}.json`);
		if (!file) return errorResponse('Exec not found', 404);
		return jsonResponse({ id, data: JSON.parse(file.content), source: file.source });
	} catch (err) {
		return persistErrorResponse(err, 'Failed to load or save exec');
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

	const files = normalizeUploads(raw.files);
	if (typeof files === 'string') return errorResponse(files);

	const jsonPath = `${EXECS_DIR}/${id}.json`;

	try {
		const existing = await getAdminTextFile(jsonPath);
		if (!existing) return errorResponse('Exec not found', 404);

		nameUploads(files, await listAdminAssetNames(EXECS_ASSETS));
		addUploadedImages('execs', data, files);

		const result = await persistAdminChanges(`admin: update exec ${id}`, [
			{ path: jsonPath, content: prettyJson(data) },
			...fileChangesForUploads('execs', files),
		]);
		return jsonResponse({ ok: true, id, data, commit: result, source: result.source });
	} catch (err) {
		return persistErrorResponse(err, 'Failed to load or save exec');
	}
};

export const DELETE: APIRoute = async ({ params }) => {
	const id = params.id ?? '';
	if (!isValidSlug(id)) return errorResponse('Invalid id');

	const jsonPath = `${EXECS_DIR}/${id}.json`;

	try {
		const existing = await getAdminTextFile(jsonPath);
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

		const result = await persistAdminChanges(`admin: delete exec ${id}`, changes);
		return jsonResponse({ ok: true, id, commit: result, source: result.source });
	} catch (err) {
		return persistErrorResponse(err, 'Failed to load or save exec');
	}
};
