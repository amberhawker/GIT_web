export const prerender = false;

import type { APIRoute } from 'astro';
import { isAdminAuthenticated } from '../../../lib/admin/auth';

export const GET: APIRoute = async ({ request }) => {
	const authenticated = await isAdminAuthenticated(request);
	return Response.json({ authenticated });
};
