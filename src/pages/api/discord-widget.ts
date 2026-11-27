export const prerender = false;

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { discordWidgetResponse } from '../../lib/discord-widget';

export const GET: APIRoute = async () => {
	const [discord] = await getCollection('links', ({ data }) => data.discordServerId !== undefined);
	return discordWidgetResponse(discord?.data.discordServerId);
};
