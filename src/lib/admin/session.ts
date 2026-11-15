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

export async function createSessionToken(sessionSecret: string): Promise<string> {
	const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
	const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ exp })));
	const signature = await sign(sessionSecret, payload);
	return `${payload}.${signature}`;
}

export async function isValidSessionToken(
	sessionSecret: string,
	token: string | undefined
): Promise<boolean> {
	if (!token) return false;
	const parts = token.split('.');
	if (parts.length !== 2) return false;
	const [payload, signature] = parts;
	if (!payload || !signature) return false;

	const ok = await verify(sessionSecret, payload, signature);
	if (!ok) return false;

	try {
		const json = new TextDecoder().decode(fromBase64Url(payload));
		const data = JSON.parse(json) as { exp?: number };
		if (typeof data.exp !== 'number') return false;
		return data.exp > Math.floor(Date.now() / 1000);
	} catch {
		return false;
	}
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
