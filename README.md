# Astro Starter Kit: Basics

```sh
npm create astro@latest -- --template basics
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## Deployment & admin security

The site is an Astro app deployed as a **Cloudflare Worker** (`@astrojs/cloudflare`, `wrangler.jsonc`). Public pages are prerendered and served by Workers Static Assets; `/admin` and `/api/admin/*` run in the Worker. Admin saves are committed to GitHub (`GITHUB_REPO` / `GITHUB_BRANCH`).

### Secrets (never commit)

Set locally in `.dev.vars` (copy `.dev.vars.example`) and in production with `npx wrangler secret put <NAME>`:

| Secret | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Single shared admin password |
| `SESSION_SECRET` | HMAC key for admin session cookies (32+ random bytes) |
| `GITHUB_TOKEN` | Fine-grained token with Contents read/write on this repo |

### Bindings (`wrangler.jsonc`)

| Binding | Type | Used for |
| --- | --- | --- |
| `ADMIN_KV` | KV namespace | Active admin sessions (`admin-session:<id>`, 7-day TTL) and failed-login counters (`login-fail:<ip>`) |
| `ADMIN_LOGIN_RATE_LIMITER` | Workers Rate Limiting | Burst cap of 10 login requests / 60 s per IP |
| `SESSION` | KV namespace | Added automatically by the Astro Cloudflare adapter (Astro sessions) |

`ADMIN_KV` has no `id`, so `wrangler deploy` provisions it automatically. To use a namespace you create yourself: `npx wrangler kv namespace create ADMIN_KV` and paste the returned `id` into `wrangler.jsonc`. Run `npm run cf-typegen` after changing bindings. `npm run dev` uses local KV automatically.

### How admin security works

- **Revocable sessions:** login stores a random session id in `ADMIN_KV`; the signed cookie only stays valid while that KV entry exists. "Log out" deletes the entry; "Log out everywhere" (`POST /api/admin/logout?all=1`) deletes all of them. Rotating `SESSION_SECRET` also invalidates every session.
- **Login rate limiting:** 5 failed passwords per IP lock that IP out for 15 minutes (HTTP 429 with `Retry-After`), plus the burst limiter above.
- **HTTPS + headers:** the Worker redirects HTTP to HTTPS (301/308) and sets HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and a `frame-ancestors`/`object-src` CSP. Static pages get the same headers from `public/_headers`. Admin responses are `Cache-Control: no-store`.
- **Uploads:** images must be PNG, JPEG, WebP, or GIF by file signature (magic bytes) and match their extension. Limits: 10 MB per image, 12 images and 30 MB per request (`src/lib/admin/upload-rules.mjs`, shared by the Worker and the local dev writer).

### Recommended Cloudflare dashboard settings

- SSL/TLS → Edge Certificates: turn on **Always Use HTTPS** (prerendered static pages are served before the Worker runs, so the edge must redirect them).
- SSL/TLS mode: **Full (strict)**.
- Optional: protect `/admin*` and `/api/admin/*` with a **Cloudflare Access** application as an extra layer in front of the shared password.

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
│   └── favicon.svg
├── src
│   ├── assets
│   │   └── astro.svg
│   ├── components
│   │   └── Welcome.astro
│   ├── layouts
│   │   └── Layout.astro
│   └── pages
│       └── index.astro
└── package.json
```

To learn more about the folder structure of an Astro project, refer to [our guide on project structure](https://docs.astro.build/en/basics/project-structure/).

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
