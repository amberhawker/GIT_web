const COOKIE_NAME = 'git_admin_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = '';
	for (const b of u8) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
	const binary = atob(padded + pad);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

async function sign(secret: string, payload: string): Promise<string> {
	const key = await importHmacKey(secret);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
	return toBase64Url(sig);
}

async function verify(secret: string, payload: string, signature: string): Promise<boolean> {
	const key = await importHmacKey(secret);
	const sigBytes = fromBase64Url(signature);
	return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
}

/** Timing-safe string compare via SHA-256 digests (fixed length). */
export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
	const enc = new TextEncoder();
	const [ha, hb] = await Promise.all([
		crypto.subtle.digest('SHA-256', enc.encode(a)),
		crypto.subtle.digest('SHA-256', enc.encode(b)),
	]);
	const aBytes = new Uint8Array(ha);
	const bBytes = new Uint8Array(hb);
	if (aBytes.byteLength !== bBytes.byteLength) return false;
	return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

export function sessionCookieName(): string {
	return COOKIE_NAME;
}

const SESSION_KEY_PREFIX = 'admin-session:';

type SessionPayload = { sid: string; exp: number };

function sessionKey(sid: string): string {
	return `${SESSION_KEY_PREFIX}${sid}`;
}

function newSessionId(): string {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Verify signature + expiry only; does not check whether the session was revoked. */
async function parseSessionToken(
	sessionSecret: string,
	token: string | undefined
): Promise<SessionPayload | null> {
	if (!token) return null;
	const parts = token.split('.');
	if (parts.length !== 2) return null;
	const [payload, signature] = parts;
	if (!payload || !signature) return null;

	try {
		if (!(await verify(sessionSecret, payload, signature))) return null;
		const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as Partial<SessionPayload>;
		if (typeof data.sid !== 'string' || !data.sid) return null;
		if (typeof data.exp !== 'number' || data.exp <= Math.floor(Date.now() / 1000)) return null;
		return { sid: data.sid, exp: data.exp };
	} catch {
		return null;
	}
}

/** Create a signed session token and record it as active in KV. */
export async function createSessionToken(sessionSecret: string, kv: KVNamespace): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const session: SessionPayload = { sid: newSessionId(), exp: now + MAX_AGE_SECONDS };
	await kv.put(sessionKey(session.sid), JSON.stringify({ createdAt: now, exp: session.exp }), {
		expirationTtl: MAX_AGE_SECONDS,
	});
	const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(session)));
	const signature = await sign(sessionSecret, payload);
	return `${payload}.${signature}`;
}

/** Valid = correctly signed, unexpired, and still present (not revoked) in KV. */
export async function isValidSessionToken(
	sessionSecret: string,
	kv: KVNamespace,
	token: string | undefined
): Promise<boolean> {
	const session = await parseSessionToken(sessionSecret, token);
	if (!session) return false;
	return (await kv.get(sessionKey(session.sid))) !== null;
}

/** Revoke one session server-side (logout). */
export async function revokeSessionToken(
	sessionSecret: string,
	kv: KVNamespace,
	token: string | undefined
): Promise<void> {
	const session = await parseSessionToken(sessionSecret, token);
	if (session) await kv.delete(sessionKey(session.sid));
}

/** Revoke every active admin session (e.g. after the shared password leaks). */
export async function revokeAllSessions(kv: KVNamespace): Promise<number> {
	let revoked = 0;
	let cursor: string | undefined;
	do {
		const page = await kv.list({ prefix: SESSION_KEY_PREFIX, cursor });
		await Promise.all(page.keys.map((key) => kv.delete(key.name)));
		revoked += page.keys.length;
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return revoked;
}

export function buildSessionCookie(token: string, secure: boolean): string {
	const parts = [
		`${COOKIE_NAME}=${token}`,
		'Path=/',
		`Max-Age=${MAX_AGE_SECONDS}`,
		'HttpOnly',
		'SameSite=Lax',
	];
	if (secure) parts.push('Secure');
	return parts.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
	const parts = [
		`${COOKIE_NAME}=`,
		'Path=/',
		'Max-Age=0',
		'HttpOnly',
		'SameSite=Lax',
	];
	if (secure) parts.push('Secure');
	return parts.join('; ');
}

export function readSessionCookie(cookieHeader: string | null): string | undefined {
	if (!cookieHeader) return undefined;
	const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
	return match?.[1];
}
