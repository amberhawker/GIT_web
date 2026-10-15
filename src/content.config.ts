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

export const collections = { events };
