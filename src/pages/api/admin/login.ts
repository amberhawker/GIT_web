export const prerender = false;

import type { APIRoute } from 'astro';
import { getAuthEnv } from '../../../lib/admin/env';
import {
	buildSessionCookie,
	createSessionToken,
	timingSafeEqualString,
} from '../../../lib/admin/session';

export const POST: APIRoute = async ({ request }) => {
	let password = '';
	const contentType = request.headers.get('content-type') ?? '';

	try {
		if (contentType.includes('application/json')) {
			const body = (await request.json()) as { password?: string };
			password = body.password ?? '';
		} else {
			const form = await request.formData();
			password = String(form.get('password') ?? '');
		}
	} catch {
		return Response.json({ error: 'Invalid request body' }, { status: 400 });
	}

	if (!password) {
		return Response.json({ error: 'Password required' }, { status: 400 });
	}

	let adminPassword: string;
	let sessionSecret: string;
	try {
		const auth = getAuthEnv();
		adminPassword = auth.ADMIN_PASSWORD;
		sessionSecret = auth.SESSION_SECRET;
	} catch {
		return Response.json({ error: 'Server auth is not configured' }, { status: 500 });
	}

	const match = await timingSafeEqualString(password, adminPassword);
	if (!match) {
		return Response.json({ error: 'Invalid password' }, { status: 401 });
	}

	const token = await createSessionToken(sessionSecret);
	const secure = new URL(request.url).protocol === 'https:';

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Set-Cookie': buildSessionCookie(token, secure),
		},
	});
};
