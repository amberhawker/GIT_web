/**
 * Resolve content-collection image paths (e.g. `/assets/execs/foo.jpg`)
 * to optimized Astro ImageMetadata from `src/assets`.
 */
const modules = import.meta.glob<{ default: ImageMetadata }>(
	'/src/assets/{execs,events,sponsors}/*.{png,jpg,jpeg,webp,gif}',
	{ eager: true }
);

const byFilename = new Map<string, ImageMetadata>();
for (const [path, mod] of Object.entries(modules)) {
	const filename = path.split('/').pop();
	if (filename) byFilename.set(filename, mod.default);
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
	const filename = pathOrFilename.split('/').pop() ?? pathOrFilename;
	const image = byFilename.get(filename);
	if (!image) {
		throw new Error(`Unknown image asset: ${pathOrFilename} (looked up as ${filename})`);
	}
	return image;
}

export function resolveAssetImageOptional(
	pathOrFilename: string | undefined | null
): ImageMetadata | undefined {
	if (!pathOrFilename) return undefined;
	const filename = pathOrFilename.split('/').pop() ?? pathOrFilename;
	return byFilename.get(filename);
}
