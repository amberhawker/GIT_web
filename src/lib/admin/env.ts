import { env } from 'cloudflare:workers';

export type AuthSecrets = {
	ADMIN_PASSWORD: string;
	SESSION_SECRET: string;
};

export type AdminSecrets = AuthSecrets & {
	GITHUB_TOKEN: string;
	GITHUB_REPO: string;
	GITHUB_BRANCH: string;
};

function requireString(e: Cloudflare.Env, key: keyof Cloudflare.Env): string {
	const value = e[key];
	if (typeof value !== 'string' || !value) {
		throw new Error(`Missing required env: ${String(key)}`);
	}
	return value;
}

/** Password + session secret only (login / middleware). */
export function getAuthEnv(): AuthSecrets {
	const e = env as Cloudflare.Env;
	return {
		ADMIN_PASSWORD: requireString(e, 'ADMIN_PASSWORD'),
		SESSION_SECRET: requireString(e, 'SESSION_SECRET'),
	};
}

/** Full admin secrets including GitHub (content write APIs). */
export function getAdminEnv(): AdminSecrets {
	const e = env as Cloudflare.Env;
	const auth = getAuthEnv();
	return {
		...auth,
		GITHUB_TOKEN: requireString(e, 'GITHUB_TOKEN'),
		GITHUB_REPO: requireString(e, 'GITHUB_REPO'),
		GITHUB_BRANCH: requireString(e, 'GITHUB_BRANCH'),
	};
}
