import { getAdminEnv } from './env';

const API = 'https://api.github.com';

export class GitHubError extends Error {
	status: number;
	body: unknown;

	constructor(message: string, status: number, body: unknown) {
		super(message);
		this.name = 'GitHubError';
		this.status = status;
		this.body = body;
	}
}

type GhJson = Record<string, unknown>;

function encodeRepoPath(path: string): string {
	return path
		.split('/')
		.filter(Boolean)
		.map(encodeURIComponent)
		.join('/');
}

async function ghResponse(
	path: string,
	token: string,
	init: RequestInit = {}
): Promise<Response> {
	const { headers: extraHeaders, ...rest } = init;
	const res = await fetch(`${API}${path}`, {
		...rest,
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
			'User-Agent': 'git-web-admin',
			...(rest.body ? { 'Content-Type': 'application/json' } : {}),
			...extraHeaders,
		},
	});

	if (!res.ok) {
		const body = await readGitHubBody(res);
		const msg =
			typeof body === 'object' &&
			body &&
			'message' in body &&
			typeof (body as { message: unknown }).message === 'string'
				? (body as { message: string }).message
				: `GitHub API ${res.status}`;
		throw new GitHubError(msg, res.status, body);
	}

	return res;
}

async function readGitHubBody(res: Response): Promise<unknown> {
	const text = await res.text();
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function gh<T = GhJson>(
	path: string,
	token: string,
	init: RequestInit = {}
): Promise<T> {
	return (await readGitHubBody(await ghResponse(path, token, init))) as T;
}

function repoParts(repo: string): { owner: string; name: string } {
	const [owner, name] = repo.split('/');
	if (!owner || !name) throw new Error(`Invalid GITHUB_REPO: ${repo}`);
	return { owner, name };
}

export type FileUpsert = {
	path: string;
	content: string;
	encoding?: 'utf-8' | 'base64';
	createOnly?: boolean;
};

export type FileDelete = {
	path: string;
	delete: true;
};

export type FileChange = FileUpsert | FileDelete;

export type CommitResult = {
	sha: string;
	url: string;
	htmlUrl: string;
	message: string;
};

type RefResponse = { object: { sha: string } };
type CommitResponse = { sha: string; tree: { sha: string }; html_url?: string };
type BlobResponse = { sha: string };
type TreeResponse = { sha: string };
type TreeListing = { tree: { path: string }[]; truncated: boolean };
type ContentFile = {
	type: string;
	name: string;
	path: string;
	sha: string;
	content?: string;
	encoding?: string;
};
type ContentEntry = {
	type: string;
	name: string;
	path: string;
	sha: string;
};

function isDelete(change: FileChange): change is FileDelete {
	return 'delete' in change && change.delete === true;
}

/** Low-level authenticated GitHub JSON request (exported for rare one-offs). */
export async function githubFetch<T = GhJson>(
	path: string,
	init: RequestInit = {}
): Promise<T> {
	const { GITHUB_TOKEN } = getAdminEnv();
	return gh<T>(path, GITHUB_TOKEN, init);
}

function decodeBase64Bytes(raw: string): Uint8Array {
	const cleaned = raw.replace(/\n/g, '');
	const binary = atob(cleaned);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Read a text file from the repo (decodes base64 content). */
export async function getRepoTextFile(path: string): Promise<{
	sha: string;
	content: string;
} | null> {
	const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH } = getAdminEnv();
	const { owner, name } = repoParts(GITHUB_REPO);

	try {
		const file = await gh<ContentFile>(
			`/repos/${owner}/${name}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
			GITHUB_TOKEN
		);
		if (file.type !== 'file' || !file.content) return null;
		const raw = file.content.replace(/\n/g, '');
		const content =
			file.encoding === 'base64'
				? new TextDecoder().decode(decodeBase64Bytes(raw))
				: file.content;
		return { sha: file.sha, content };
	} catch (err) {
		if (err instanceof GitHubError && err.status === 404) return null;
		throw err;
	}
}

/** Read a binary file from the repo (e.g. images for admin previews). */
export async function getRepoBinaryFile(path: string): Promise<ReadableStream<Uint8Array> | null> {
	const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH } = getAdminEnv();
	const { owner, name } = repoParts(GITHUB_REPO);

	try {
		const file = await ghResponse(
			`/repos/${owner}/${name}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
			GITHUB_TOKEN,
			{ headers: { Accept: 'application/vnd.github.raw+json' } }
		);
		return file.body;
	} catch (err) {
		if (err instanceof GitHubError && err.status === 404) return null;
		throw err;
	}
}

/** List entries in a repo directory (non-recursive). */
export async function listRepoDirectory(path: string): Promise<ContentEntry[]> {
	const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH } = getAdminEnv();
	const { owner, name } = repoParts(GITHUB_REPO);

	try {
		const data = await gh<ContentEntry[] | ContentFile>(
			`/repos/${owner}/${name}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
			GITHUB_TOKEN
		);
		if (!Array.isArray(data)) return [];
		return data;
	} catch (err) {
		if (err instanceof GitHubError && err.status === 404) return [];
		throw err;
	}
}

/**
 * Atomically commit one or more file creates/updates/deletes and fast-forward the branch.
 * Uses the Git Data API (blob → tree → commit → ref update).
 */
export async function commitFiles(
	message: string,
	changes: FileChange[]
): Promise<CommitResult> {
	if (changes.length === 0) {
		throw new Error('No file changes to commit');
	}

	const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH } = getAdminEnv();
	const { owner, name } = repoParts(GITHUB_REPO);
	const token = GITHUB_TOKEN;
	const base = `/repos/${owner}/${name}`;

	const ref = await gh<RefResponse>(
		`${base}/git/ref/heads/${encodeURIComponent(GITHUB_BRANCH)}`,
		token
	);
	const headSha = ref.object.sha;

	const headCommit = await gh<CommitResponse>(`${base}/git/commits/${headSha}`, token);
	const baseTreeSha = headCommit.tree.sha;

	const newFiles = changes.filter((change): change is FileUpsert => !isDelete(change) && change.createOnly === true);
	if (newFiles.length > 0) {
		const { tree, truncated } = await gh<TreeListing>(`${base}/git/trees/${baseTreeSha}?recursive=1`, token);
		if (truncated) throw new GitHubError('Cannot verify upload names: repository tree is incomplete', 502, null);

		const occupied = new Set(tree.map(({ path }) => path.toLowerCase()));
		for (const { path } of newFiles) {
			const key = path.toLowerCase();
			if (occupied.has(key)) {
				throw new GitHubError(`Image already exists: ${path}; refresh and retry`, 409, null);
			}
			occupied.add(key);
		}
	}

	const treeItems: Array<{
		path: string;
		mode: '100644';
		type: 'blob';
		sha: string | null;
	}> = [];

	for (const change of changes) {
		if (isDelete(change)) {
			treeItems.push({
				path: change.path,
				mode: '100644',
				type: 'blob',
				sha: null,
			});
			continue;
		}

		const encoding = change.encoding ?? 'utf-8';
		const blob = await gh<BlobResponse>(`${base}/git/blobs`, token, {
			method: 'POST',
			body: JSON.stringify({
				content: change.content,
				encoding: encoding === 'base64' ? 'base64' : 'utf-8',
			}),
		});

		treeItems.push({
			path: change.path,
			mode: '100644',
			type: 'blob',
			sha: blob.sha,
		});
	}

	const tree = await gh<TreeResponse>(`${base}/git/trees`, token, {
		method: 'POST',
		body: JSON.stringify({
			base_tree: baseTreeSha,
			tree: treeItems,
		}),
	});

	const commit = await gh<CommitResponse>(`${base}/git/commits`, token, {
		method: 'POST',
		body: JSON.stringify({
			message,
			tree: tree.sha,
			parents: [headSha],
		}),
	});

	try {
		await gh(`${base}/git/refs/heads/${encodeURIComponent(GITHUB_BRANCH)}`, token, {
			method: 'PATCH',
			body: JSON.stringify({
				sha: commit.sha,
				force: false,
			}),
		});
	} catch (err) {
		if (err instanceof GitHubError && err.status === 422) {
			throw new GitHubError(
				'Push rejected — branch moved; refresh and retry',
				422,
				err.body
			);
		}
		throw err;
	}

	const htmlUrl =
		commit.html_url ?? `https://github.com/${owner}/${name}/commit/${commit.sha}`;

	return {
		sha: commit.sha,
		url: `${API}${base}/git/commits/${commit.sha}`,
		htmlUrl,
		message,
	};
}
