import { glob, file } from 'astro/loaders';
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
            }).default({path: '/assets/events/placeholder.png', alt: 'placeholder event img'})
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
        img: z.string().default('/assets/execs/placeholder.jpg'),
        degree: z.string(),
        description: z.string()

    })
});

const links = defineCollection({
    loader: file("src/data/links.json"),
    schema: z.object({
        id: z.string(),
        href: z.string(),
        ico: z.object({
            src: z.string(),
            bg: z.string()
        }).optional()
    })
});

const sponsors = defineCollection({
    loader: glob({
        pattern: '**/*.json',
        base: './src/data/sponsors'
    }),
    schema: z.object({
        name: z.string(),
        description: z.string(),
        img: z.string(),
        address: z.string().default(""),
        contact: z.string().default("")
    })
})

export const collections = { events, execs, links, sponsors };
