export const prerender = false;

import type { APIRoute } from 'astro';
import { clearSessionCookie } from '../../../lib/admin/session';

export const POST: APIRoute = async ({ request }) => {
	const secure = new URL(request.url).protocol === 'https:';
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Set-Cookie': clearSessionCookie(secure),
		},
	});
};
