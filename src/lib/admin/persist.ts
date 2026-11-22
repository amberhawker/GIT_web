import { commitFiles, getRepoTextFile, GitHubError, listRepoDirectory, type CommitResult, type FileChange } from './github';
import {
	applyLocalFileChanges,
	isLocalAdminWriteEnabled,
	listLocalDirectory,
	readLocalTextFile,
} from './local';

export type PersistResult = CommitResult & { source: 'github' | 'local' };

/**
 * Commit via GitHub; in DEV, fall back to writing the local workspace
 * so `/admin` updates can be exercised without a valid token.
 */
export async function persistAdminChanges(
	message: string,
	changes: FileChange[]
): Promise<PersistResult> {
	try {
		const commit = await commitFiles(message, changes);
		return { ...commit, source: 'github' };
	} catch (err) {
		if (!isLocalAdminWriteEnabled()) throw err;
		console.warn('admin: GitHub write failed, applying locally', err);
		const commit = await applyLocalFileChanges(message, changes);
		return { ...commit, source: 'local' };
	}
}

/**
 * Read a text file from GitHub, or from disk in DEV when GitHub is unavailable.
 */
export async function getAdminTextFile(
	path: string
): Promise<{ sha: string; content: string; source: 'github' | 'local' } | null> {
	try {
		const file = await getRepoTextFile(path);
		if (file) return { ...file, source: 'github' };
		// GitHub answered (file missing). Don't invent a local hit for prod parity.
		if (!isLocalAdminWriteEnabled()) return null;
	} catch (err) {
		if (!isLocalAdminWriteEnabled()) throw err;
		console.warn('admin: GitHub read failed, trying local file', err);
	}

	const local = await readLocalTextFile(path);
	return local ? { ...local, source: 'local' } : null;
}

/** File names in a repo folder, from GitHub or (in DEV) from disk. */
export async function listAdminAssetNames(dir: string): Promise<string[]> {
	try {
		return (await listRepoDirectory(dir)).filter((entry) => entry.type === 'file').map((entry) => entry.name);
	} catch (err) {
		if (!isLocalAdminWriteEnabled()) throw err;
		console.warn('admin: GitHub list failed, using local files', err);
		return listLocalDirectory(dir);
	}
}

export function persistErrorResponse(err: unknown, fallback: string): Response {
	if (err instanceof GitHubError) {
		return Response.json(
			{ error: err.message },
			{ status: err.status >= 400 && err.status < 600 ? err.status : 502 }
		);
	}
	console.error(err);
	return Response.json({ error: fallback }, { status: 500 });
}
