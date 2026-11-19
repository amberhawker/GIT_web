import { defineMiddleware } from 'astro:middleware';
import { isAdminAuthenticated } from './lib/admin/auth';
import { MAX_ADMIN_REQUEST_BYTES } from './lib/admin/upload-rules.mjs';
import { httpsRedirect, withSecurityHeaders } from './lib/security';

export const onRequest = defineMiddleware(async (context, next) => {
	if (context.isPrerendered) return next();

	const { url, request } = context;
	const redirect = httpsRedirect(url, request.method);
	if (redirect) return redirect;

	const { pathname } = url;
	const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');
	const isAdminApi = pathname.startsWith('/api/admin/');
	const finish = (res: Response) =>
		withSecurityHeaders(res, {
			https: url.protocol === 'https:',
			noStore: isAdminPath || isAdminApi,
		});

	if (!isAdminPath && !isAdminApi) {
		context.locals.adminAuthed = false;
		return finish(await next());
	}

	if (isAdminApi) {
		const length = Number(request.headers.get('content-length') ?? 0);
		if (length > MAX_ADMIN_REQUEST_BYTES) {
			return finish(Response.json({ error: 'Request body too large' }, { status: 413 }));
		}
	}

	const authed = await isAdminAuthenticated(request);
	context.locals.adminAuthed = authed;

	const isPublicApi =
		pathname === '/api/admin/login' || pathname === '/api/admin/session';

	if (isAdminApi && !isPublicApi && !authed) {
		return finish(Response.json({ error: 'Unauthorized' }, { status: 401 }));
	}

	return finish(await next());
});
