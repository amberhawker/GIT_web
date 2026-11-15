export const prerender = false;

import type { APIRoute } from 'astro';
import {
	GALLERY_ASSETS,
	errorResponse,
	fileChangesForUploads,
	isValidImageFilename,
	jsonResponse,
	normalizeUploads,
	publicAssetPath,
} from '../../../../lib/admin/content';
import { commitFiles, GitHubError, listRepoDirectory } from '../../../../lib/admin/github';
import { listLocalGallery } from '../../../../lib/admin/local';

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
		return jsonResponse({ images: listLocalGallery(), source: 'local' });
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

	for (const file of files) {
		if (!isValidImageFilename(file.filename)) {
			return errorResponse(`Invalid filename: ${file.filename}`);
		}
	}

	try {
		const result = await commitFiles(
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
			},
			201
		);
	} catch (err) {
		return githubError(err);
	}
};

function githubError(err: unknown): Response {
	if (err instanceof GitHubError) {
		return errorResponse(err.message, err.status >= 400 && err.status < 600 ? err.status : 502);
	}
	console.error(err);
	return errorResponse('Failed to load or save gallery', 500);
}
