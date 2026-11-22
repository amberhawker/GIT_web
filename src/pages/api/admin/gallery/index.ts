export const prerender = false;

import type { APIRoute } from 'astro';
import {
	GALLERY_ASSETS,
	errorResponse,
	fileChangesForUploads,
	jsonResponse,
	normalizeUploads,
	publicAssetPath,
	uniqueImageFilename,
} from '../../../../lib/admin/content';
import { listRepoDirectory } from '../../../../lib/admin/github';
import { listLocalGallery } from '../../../../lib/admin/local';
import { persistAdminChanges, persistErrorResponse } from '../../../../lib/admin/persist';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

export const GET: APIRoute = async () => {
	try {
		const entries = await listRepoDirectory(GALLERY_ASSETS);
		const images = entries
			.filter((entry) => entry.type === 'file' && IMAGE_EXT.test(entry.name))
			.map((entry) => ({
				name: entry.name,
				path: publicAssetPath('gallery', entry.name),
				sha: entry.sha,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		return jsonResponse({ images });
	} catch (err) {
		console.warn('admin gallery: GitHub read failed, using local files', err);
		return jsonResponse({ images: await listLocalGallery(), source: 'local' });
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

	// Accept either { files: [...] } or a single { filename, contentBase64 }
	const filesInput =
		raw.files ??
		(typeof raw.filename === 'string'
			? [{ filename: raw.filename, contentBase64: raw.contentBase64 }]
			: undefined);

	const files = normalizeUploads(filesInput);
	if (typeof files === 'string') return errorResponse(files);
	if (files.length === 0) return errorResponse('No files to upload');

	try {
		const existing = await listRepoDirectory(GALLERY_ASSETS);
		const taken = new Set(existing.map((entry) => entry.name.toLowerCase()));
		for (const file of files) file.filename = uniqueImageFilename(file.filename, taken);

		const result = await persistAdminChanges(
			files.length === 1
				? `admin: add gallery image ${files[0].filename}`
				: `admin: add ${files.length} gallery images`,
			fileChangesForUploads('gallery', files)
		);
		return jsonResponse(
			{
				ok: true,
				images: files.map((f) => ({
					name: f.filename,
					path: publicAssetPath('gallery', f.filename),
				})),
				commit: result,
				source: result.source,
			},
			201
		);
	} catch (err) {
		return persistErrorResponse(err, 'Failed to load or save gallery');
	}
};
