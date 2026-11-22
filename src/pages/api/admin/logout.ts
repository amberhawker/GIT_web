export const prerender = false;

import type { APIRoute } from 'astro';
import { getAuthEnv } from '../../../lib/admin/env';
import { getAdminKV } from '../../../lib/admin/kv';
import {
	clearSessionCookie,
	readSessionCookie,
	revokeAllSessions,
	revokeSessionToken,
} from '../../../lib/admin/session';

/**
 * Revoke the caller's session server-side and clear the cookie.
 * `?all=1` (or JSON `{ "all": true }`) revokes every active admin session.
 * Single-session logout is allowed without a live session so a stale cookie
 * can always be cleared; `all` requires an authenticated session.
 */
export const POST: APIRoute = async ({ request, url, locals }) => {
	let all = url.searchParams.get('all') === '1';
	if (!all && (request.headers.get('content-type') ?? '').includes('application/json')) {
		const body = (await request.json().catch(() => ({}))) as { all?: unknown };
		all = body.all === true;
	}

	if (all && !locals.adminAuthed) {
		return Response.json({ error: 'Unauthorized' }, { status: 401 });
	}

	let revoked = 0;
	try {
		const { SESSION_SECRET } = getAuthEnv();
		const kv = getAdminKV();
		if (all) {
			revoked = await revokeAllSessions(kv);
		} else {
			await revokeSessionToken(SESSION_SECRET, kv, readSessionCookie(request.headers.get('cookie')));
			revoked = 1;
		}
	} catch (err) {
		console.error('admin logout: failed to revoke session', err);
		return Response.json({ error: 'Failed to revoke session' }, { status: 500 });
	}

	const secure = new URL(request.url).protocol === 'https:';
	return new Response(JSON.stringify({ ok: true, revoked }), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Set-Cookie': clearSessionCookie(secure),
		},
	});
};
