import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discordWidgetResponse } from '../src/lib/discord-widget.ts';

test('returns only the visible Discord widget data and caches success briefly', async (t) => {
	const member = { username: 'Member', avatar_url: null, status: 'online' };
	const channel = { name: 'Lounge', position: 1 };
	const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
		assert.equal(url, 'https://discord.com/api/guilds/123/widget.json');
		assert.equal(options.redirect, 'manual');
		return Response.json({
			id: '123',
			instant_invite: null,
			presence_count: 9,
			members: Array.from({ length: 9 }, () => ({ ...member, id: 'member-id' })),
			channels: [{ ...channel, id: 'channel-id' }],
		});
	});

	const response = await discordWidgetResponse('123');
	assert.equal(fetch.mock.callCount(), 1);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
	assert.deepEqual(await response.json(), {
		instant_invite: null,
		presence_count: 9,
		members: Array.from({ length: 6 }, () => member),
		channels: [channel],
	});
});

test('does not fetch for an unconfigured guild or expose upstream failures', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async () =>
		new Response('upstream error details', { status: 429 }));

	assert.equal((await discordWidgetResponse()).status, 503);
	assert.equal(fetch.mock.callCount(), 0);

	const response = await discordWidgetResponse('123');
	assert.equal(response.status, 502);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(await response.json(), { error: 'Discord activity unavailable' });

	fetch.mock.mockImplementation(async () => Response.json({ members: 'invalid' }));
	assert.equal((await discordWidgetResponse('123')).status, 502);

	fetch.mock.mockImplementation(async () => Response.redirect('https://discord.com/'));
	assert.equal((await discordWidgetResponse('123')).status, 502);
});
