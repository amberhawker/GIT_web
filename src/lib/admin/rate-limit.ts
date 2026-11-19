import { env } from 'cloudflare:workers';

/** Failed attempts allowed per client IP within the window before lockout. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

const KEY_PREFIX = 'login-fail:';

type FailureRecord = { count: number; resetAt: number };

export type LoginLimitResult = { allowed: true } | { allowed: false; retryAfter: number };

export function clientIp(request: Request, fallback?: string): string {
	return request.headers.get('cf-connecting-ip') ?? fallback ?? 'unknown';
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

async function readFailures(kv: KVNamespace, ip: string): Promise<FailureRecord | null> {
	const record = await kv.get<FailureRecord>(`${KEY_PREFIX}${ip}`, 'json');
	if (!record || record.resetAt <= nowSeconds()) return null;
	return record;
}

/**
 * Check before verifying the password. Two layers:
 * - Workers Rate Limiting binding (`ADMIN_LOGIN_RATE_LIMITER`) caps request bursts per IP.
 * - KV counter locks an IP out after LOGIN_MAX_FAILURES failures per window.
 */
export async function checkLoginAllowed(kv: KVNamespace, ip: string): Promise<LoginLimitResult> {
	const limiter = (env as Partial<Cloudflare.Env>).ADMIN_LOGIN_RATE_LIMITER;
	if (limiter) {
		const { success } = await limiter.limit({ key: `admin-login:${ip}` });
		if (!success) return { allowed: false, retryAfter: 60 };
	}

	const record = await readFailures(kv, ip);
	if (record && record.count >= LOGIN_MAX_FAILURES) {
		return { allowed: false, retryAfter: Math.max(1, record.resetAt - nowSeconds()) };
	}
	return { allowed: true };
}

export async function recordLoginFailure(kv: KVNamespace, ip: string): Promise<void> {
	const record = (await readFailures(kv, ip)) ?? {
		count: 0,
		resetAt: nowSeconds() + LOGIN_WINDOW_SECONDS,
	};
	record.count += 1;
	await kv.put(`${KEY_PREFIX}${ip}`, JSON.stringify(record), {
		expirationTtl: Math.max(60, record.resetAt - nowSeconds()),
	});
}

export async function clearLoginFailures(kv: KVNamespace, ip: string): Promise<void> {
	await kv.delete(`${KEY_PREFIX}${ip}`);
}
