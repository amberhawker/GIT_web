export const prerender = false;

import type { APIRoute } from 'astro';
import {
	GALLERY_ASSETS,
	errorResponse,
	isValidImageFilename,
	jsonResponse,
	repoAssetPath,
} from '../../../../lib/admin/content';
import { commitFiles, GitHubError, listRepoDirectory } from '../../../../lib/admin/github';

export const DELETE: APIRoute = async ({ params }) => {
	const name = params.name ?? '';
	if (!isValidImageFilename(name)) return errorResponse('Invalid image name');

	try {
		const entries = await listRepoDirectory(GALLERY_ASSETS);
		const exists = entries.some((entry) => entry.type === 'file' && entry.name === name);
		if (!exists) return errorResponse('Image not found', 404);

		const result = await commitFiles(`admin: delete gallery image ${name}`, [
			{ path: repoAssetPath('gallery', name), delete: true },
		]);
		return jsonResponse({ ok: true, name, commit: result });
	} catch (err) {
		if (err instanceof GitHubError) {
			return errorResponse(err.message, err.status >= 400 && err.status < 600 ? err.status : 502);
		}
		console.error(err);
		return errorResponse('Failed to delete gallery image', 500);
	}
};
