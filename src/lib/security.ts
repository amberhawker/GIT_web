/**
 * Security headers for Worker-rendered responses (admin page + API).
 * Prerendered pages and static files are served by Workers Static Assets,
 * which applies the matching rules in public/_headers instead — keep both in sync.
 */
export const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
};

export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLocalHost(hostname: string): boolean {
	return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

/** Redirect plain-HTTP requests to HTTPS (308 keeps the method/body for API calls). */
export function httpsRedirect(url: URL, method: string): Response | null {
	if (url.protocol !== 'http:' || isLocalHost(url.hostname)) return null;
	const target = new URL(url);
	target.protocol = 'https:';
	const status = method === 'GET' || method === 'HEAD' ? 301 : 308;
	return new Response(null, { status, headers: { Location: target.toString() } });
}

export function withSecurityHeaders(
	response: Response,
	options: { https: boolean; noStore: boolean }
): Response {
	let res = response;
	const apply = (headers: Headers) => {
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			if (!headers.has(name)) headers.set(name, value);
		}
		if (options.https) {
			headers.set('Strict-Transport-Security', HSTS_VALUE);
			const csp = headers.get('Content-Security-Policy');
			if (csp && !csp.includes('upgrade-insecure-requests')) {
				headers.set('Content-Security-Policy', `${csp}; upgrade-insecure-requests`);
			}
		}
		if (options.noStore) {
			headers.set('Cache-Control', 'no-store');
			headers.set('X-Robots-Tag', 'noindex, nofollow');
		}
	};
	try {
		apply(res.headers);
	} catch {
		// Some responses (e.g. from fetch) have immutable headers.
		res = new Response(res.body, res);
		apply(res.headers);
	}
	return res;
}
