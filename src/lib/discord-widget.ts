import { z } from 'astro/zod';

const cacheSeconds = 60;
const discordWidgetSchema = z.object({
	instant_invite: z.string().nullish(),
	presence_count: z.number().int().nonnegative(),
	members: z.array(z.object({
		username: z.string(),
		avatar_url: z.string().nullish(),
		status: z.string(),
	})).transform((members) => members.slice(0, 6)),
	channels: z.array(z.object({
		name: z.string(),
		position: z.number(),
	})),
});

export type DiscordWidgetData = z.infer<typeof discordWidgetSchema>;

export async function discordWidgetResponse(serverId?: string): Promise<Response> {
	const unavailable = (status: number) =>
		Response.json({ error: 'Discord activity unavailable' }, {
			status,
			headers: { 'Cache-Control': 'no-store' },
		});

	if (!serverId) return unavailable(503);

	try {
		const options = {
			redirect: 'manual' as const,
			signal: AbortSignal.timeout(3500),
			cf: { cacheTtlByStatus: { 200: cacheSeconds, '300-599': -1 } },
		};
		const response = await fetch(`https://discord.com/api/guilds/${serverId}/widget.json`, options);
		if (!response.ok) return unavailable(502);

		const result = discordWidgetSchema.safeParse(await response.json());
		if (!result.success) return unavailable(502);

		return Response.json(result.data, {
			headers: { 'Cache-Control': `public, max-age=${cacheSeconds}` },
		});
	} catch {
		return unavailable(502);
	}
}
