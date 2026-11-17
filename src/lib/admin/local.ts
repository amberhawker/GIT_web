/**
 * Bundled local content for admin GET fallbacks.
 * Writes still go through GitHub; reads use these when the token/API fails.
 */
import { isValidImageFilename, publicAssetPath } from './content';

const eventModules = import.meta.glob('/src/data/events/*.json', { eager: true });
const execModules = import.meta.glob('/src/data/execs/*.json', { eager: true });

/** Paths only — do not import as ImageMetadata (breaks Workers / @fs redirects). */
const galleryPaths = Object.keys(
	import.meta.glob('/src/assets/gallery/*.{png,jpg,jpeg,webp,gif}')
);

function jsonDefault(mod: unknown): unknown {
	if (mod && typeof mod === 'object' && 'default' in mod) {
		return (mod as { default: unknown }).default;
	}
	return mod;
}

function idFromPath(path: string): string {
	return path.split('/').pop()!.replace(/\.json$/i, '');
}

export function listLocalEvents(): { id: string; data: unknown }[] {
	return Object.entries(eventModules)
		.map(([path, mod]) => ({ id: idFromPath(path), data: jsonDefault(mod) }))
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function listLocalExecs(): { id: string; data: unknown }[] {
	return Object.entries(execModules)
		.map(([path, mod]) => ({ id: idFromPath(path), data: jsonDefault(mod) }))
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function listLocalGallery(): { name: string; path: string }[] {
	return galleryPaths
		.map((path) => {
			const name = path.split('/').pop()!;
			return { name, path: publicAssetPath('gallery', name) };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read a gallery image from the local workspace (dev / nodejs_compat). */
export async function readLocalGalleryFile(name: string): Promise<Uint8Array | null> {
	if (!isValidImageFilename(name)) return null;
	try {
		const { readFile } = await import('node:fs/promises');
		const { basename, join } = await import('node:path');
		const safe = basename(name);
		if (safe !== name || !isValidImageFilename(safe)) return null;
		const bytes = await readFile(join(process.cwd(), 'src/assets/gallery', safe));
		return new Uint8Array(bytes);
	} catch {
		return null;
	}
}
