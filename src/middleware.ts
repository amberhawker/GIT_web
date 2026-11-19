import { defineMiddleware } from 'astro:middleware';
import { isAdminAuthenticated } from './lib/admin/auth';
import { MAX_ADMIN_REQUEST_BYTES } from './lib/admin/upload-rules.mjs';
import { httpsRedirect, withSecurityHeaders } from './lib/security';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const MAX_LOGIN_REQUEST_BYTES = 4 * 1024;

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

	if (isAdminApi && BODY_METHODS.has(request.method)) {
		const header = request.headers.get('content-length');
		if (header === null && request.body !== null) {
			return finish(Response.json({ error: 'Content-Length required' }, { status: 411 }));
		}
		const limit = pathname === '/api/admin/login' ? MAX_LOGIN_REQUEST_BYTES : MAX_ADMIN_REQUEST_BYTES;
		if (Number(header ?? 0) > limit) {
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
