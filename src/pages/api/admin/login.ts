export const prerender = false;

import type { APIRoute } from 'astro';
import { getAuthEnv } from '../../../lib/admin/env';
import { getAdminKV } from '../../../lib/admin/kv';
import {
	checkLoginAllowed,
	clearLoginFailures,
	clientIp,
	recordLoginFailure,
} from '../../../lib/admin/rate-limit';
import {
	buildSessionCookie,
	createSessionToken,
	timingSafeEqualString,
} from '../../../lib/admin/session';

function tooManyAttempts(retryAfter: number): Response {
	const minutes = Math.max(1, Math.ceil(retryAfter / 60));
	return Response.json(
		{
			error: `Too many login attempts from this network. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
		},
		{ status: 429, headers: { 'Retry-After': String(retryAfter) } }
	);
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
	let adminPassword: string;
	let sessionSecret: string;
	let kv: KVNamespace;
	try {
		const auth = getAuthEnv();
		adminPassword = auth.ADMIN_PASSWORD;
		sessionSecret = auth.SESSION_SECRET;
		kv = getAdminKV();
	} catch (err) {
		console.error('admin login: server auth is not configured', err);
		return Response.json({ error: 'Server auth is not configured' }, { status: 500 });
	}

	let fallbackIp: string | undefined;
	try {
		fallbackIp = clientAddress;
	} catch {
		fallbackIp = undefined;
	}
	const ip = clientIp(request, fallbackIp);

	const limit = await checkLoginAllowed(kv, ip);
	if (!limit.allowed) return tooManyAttempts(limit.retryAfter);

	let password = '';
	const contentType = request.headers.get('content-type') ?? '';

	try {
		if (contentType.includes('application/json')) {
			const body = (await request.json()) as { password?: string };
			password = typeof body.password === 'string' ? body.password : '';
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

	const match = await timingSafeEqualString(password, adminPassword);
	if (!match) {
		await recordLoginFailure(kv, ip);
		return Response.json({ error: 'Invalid password' }, { status: 401 });
	}

	await clearLoginFailures(kv, ip);
	const token = await createSessionToken(sessionSecret, kv);
	const secure = new URL(request.url).protocol === 'https:';

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Set-Cookie': buildSessionCookie(token, secure),
		},
	});
};
