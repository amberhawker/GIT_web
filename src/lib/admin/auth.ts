import type { APIContext } from 'astro';
import { getAuthEnv } from './env';
import { getAdminKV } from './kv';
import { isValidSessionToken, readSessionCookie } from './session';

export async function isAdminAuthenticated(request: Request): Promise<boolean> {
	try {
		const { SESSION_SECRET } = getAuthEnv();
		const token = readSessionCookie(request.headers.get('cookie'));
		if (!token) return false;
		return await isValidSessionToken(SESSION_SECRET, getAdminKV(), token);
	} catch (err) {
		console.error('admin auth check failed', err);
		return false;
	}
}

/** Return 401 JSON if the request is not authenticated. */
export async function requireAdminApi(context: APIContext): Promise<Response | null> {
	const ok = await isAdminAuthenticated(context.request);
	if (ok) return null;
	return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
