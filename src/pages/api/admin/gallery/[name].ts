export const prerender = false;

import type { APIRoute } from 'astro';
import {
	GALLERY_ASSETS,
	errorResponse,
	isValidImageFilename,
	jsonResponse,
	repoAssetPath,
} from '../../../../lib/admin/content';
import { getRepoBinaryFile, listRepoDirectory } from '../../../../lib/admin/github';
import { isLocalAdminWriteEnabled, listLocalGallery, readLocalGalleryFile } from '../../../../lib/admin/local';
import { persistAdminChanges, persistErrorResponse } from '../../../../lib/admin/persist';

function contentTypeFor(name: string): string {
	const lower = name.toLowerCase();
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.gif')) return 'image/gif';
	return 'application/octet-stream';
}

function imageResponse(bytes: Uint8Array, name: string): Response {
	return new Response(bytes, {
		status: 200,
		headers: {
			'Content-Type': contentTypeFor(name),
			'Cache-Control': 'private, max-age=60',
		},
	});
}

/** Serve gallery image bytes for admin previews (src/assets is not publicly URL-mapped). */
export const GET: APIRoute = async ({ params }) => {
	const name = params.name ?? '';
	if (!isValidImageFilename(name)) return errorResponse('Invalid image name');

	try {
		const file = await getRepoBinaryFile(repoAssetPath('gallery', name));
		if (file) return imageResponse(file.bytes, name);
	} catch (err) {
		console.warn('admin gallery image: GitHub read failed, trying local file', err);
	}

	const local = await readLocalGalleryFile(name);
	if (local) return imageResponse(local, name);

	return errorResponse('Image not found', 404);
};

export const DELETE: APIRoute = async ({ params }) => {
	const name = params.name ?? '';
	if (!isValidImageFilename(name)) return errorResponse('Invalid image name');

	try {
		let exists = false;
		try {
			const entries = await listRepoDirectory(GALLERY_ASSETS);
			exists = entries.some((entry) => entry.type === 'file' && entry.name === name);
		} catch (err) {
			if (!isLocalAdminWriteEnabled()) throw err;
			console.warn('admin gallery delete: GitHub list failed, checking local', err);
			const local = await listLocalGallery();
			exists = local.some((image) => image.name === name);
		}

		if (!exists) return errorResponse('Image not found', 404);

		const result = await persistAdminChanges(`admin: delete gallery image ${name}`, [
			{ path: repoAssetPath('gallery', name), delete: true },
		]);
		return jsonResponse({ ok: true, name, commit: result, source: result.source });
	} catch (err) {
		return persistErrorResponse(err, 'Failed to delete gallery image');
	}
};
