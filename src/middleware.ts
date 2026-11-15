import { defineMiddleware } from 'astro:middleware';
import { isAdminAuthenticated } from './lib/admin/auth';

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;
	const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');
	const isAdminApi = pathname.startsWith('/api/admin/');

	if (!isAdminPath && !isAdminApi) {
		context.locals.adminAuthed = false;
		return next();
	}

	const authed = await isAdminAuthenticated(context.request);
	context.locals.adminAuthed = authed;

	const isPublicApi =
		pathname === '/api/admin/login' || pathname === '/api/admin/session';

	if (isAdminApi && !isPublicApi && !authed) {
		return Response.json({ error: 'Unauthorized' }, { status: 401 });
	}

	return next();
});
