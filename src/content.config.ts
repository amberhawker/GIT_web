import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';

const events = defineCollection({
    loader: glob({
        pattern: '**/*.json',
        base: './src/data/events'
    }),
    schema: z.object({
        title: z.string(),
        imgs: z.array(
            z.object({
                path: z.string(),
                alt: z.string().optional(),
            })
        ),
        description: z.string().optional(),
        date: z.string().optional(),
        featured: z.boolean().default(false)
    }),
});

const execs = defineCollection({
    loader: glob({
        pattern: '**/*.json',
        base: './src/data/execs'
    }),
    schema: z.object({
        role: z.string(),
        name: z.string(),
        // img should be normalized to one std, web-friendly & highly compatible filetype. not required
        img: z.string(),
        degree: z.string(),
        description: z.string()

    })
})

export const collections = { events, execs };
