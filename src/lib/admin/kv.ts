import { env } from 'cloudflare:workers';

/**
 * KV namespace for revocable admin sessions and login-attempt counters.
 * Binding is declared in wrangler.jsonc as `ADMIN_KV`.
 */
export function getAdminKV(): KVNamespace {
	const kv = (env as Partial<Cloudflare.Env>).ADMIN_KV;
	if (!kv) throw new Error('Missing required KV binding: ADMIN_KV');
	return kv;
}
