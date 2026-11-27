import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { withSecurityHeaders } from '../src/lib/security.ts';

test('static and Worker responses enforce one year of HSTS including subdomains without preload', async () => {
	const expected = 'max-age=31536000; includeSubDomains';
	const staticHeaders = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
	assert.equal(staticHeaders.match(/^ {2}Strict-Transport-Security: (.+)$/m)?.[1], expected);

	const https = withSecurityHeaders(new Response(), { https: true, noStore: false });
	assert.equal(https.headers.get('Strict-Transport-Security'), expected);

	const http = withSecurityHeaders(new Response(), { https: false, noStore: false });
	assert.equal(http.headers.get('Strict-Transport-Security'), null);
});
