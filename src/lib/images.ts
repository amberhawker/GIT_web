/**
 * Resolve content-collection image paths (e.g. `/assets/execs/foo.jpg`)
 * to optimized Astro ImageMetadata from `src/assets`.
 */
const modules = import.meta.glob<{ default: ImageMetadata }>(
	'/src/assets/{execs,events,sponsors}/*.{png,jpg,jpeg,webp,gif}',
	{ eager: true }
);

// Exact `/assets/<folder>/<file>` first, so same-named images in different folders stay distinct.
const byPath = new Map<string, ImageMetadata>();
const byFilename = new Map<string, ImageMetadata>();
for (const [path, mod] of Object.entries(modules)) {
	byPath.set(path.replace(/^\/src/, ''), mod.default);
	const filename = path.split('/').pop();
	if (filename) byFilename.set(filename, mod.default);
}

function lookup(pathOrFilename: string): ImageMetadata | undefined {
	const filename = pathOrFilename.split('/').pop() ?? pathOrFilename;
	return byPath.get(pathOrFilename) ?? byFilename.get(filename);
}

const fallbackModules = import.meta.glob<{ default: ImageMetadata }>(
	'/src/assets/*.{png,jpg,jpeg,webp,gif}',
	{ eager: true }
);
for (const [path, mod] of Object.entries(fallbackModules)) {
	const filename = path.split('/').pop();
	if (filename && !byFilename.has(filename)) {
		byFilename.set(filename, mod.default);
	}
}

export function resolveAssetImage(pathOrFilename: string): ImageMetadata {
	const image = lookup(pathOrFilename);
	if (!image) {
		throw new Error(`Unknown image asset: ${pathOrFilename}`);
	}
	return image;
}

export function resolveAssetImageOptional(
	pathOrFilename: string | undefined | null
): ImageMetadata | undefined {
	if (!pathOrFilename) return undefined;
	return lookup(pathOrFilename);
}
