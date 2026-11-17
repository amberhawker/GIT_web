import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { createAdminLocalWriteMiddleware } from './scripts/admin-local-write.mjs';

/** Intercept `/api/admin` mutations in Node so local `/admin` saves can write the workspace. */
function adminLocalWritePlugin() {
	return {
		name: 'admin-local-write',
		configureServer(server) {
			server.middlewares.use(createAdminLocalWriteMiddleware(server.config.root));
		},
	};
}

export default defineConfig({
	adapter: cloudflare({
		imageService: 'compile',
	}),
	vite: {
		plugins: [tailwindcss(), adminLocalWritePlugin()],
	},
});
