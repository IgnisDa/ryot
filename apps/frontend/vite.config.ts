import { remixPWA } from "@remix-pwa/dev";
import { vitePlugin as remix } from "@remix-run/dev";
import { remixDevTools } from "remix-development-tools";
import { remixRoutes } from "remix-routes/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	server: {
		port: process.env.FRONTEND_PORT
			? Number.parseInt(process.env.FRONTEND_PORT)
			: undefined,
		host: process.env.FRONTEND_HOST,
	},
	plugins: [
		remixDevTools(),
		remix({
			future: { unstable_singleFetch: true },
		}),
		remixRoutes(),
		tsconfigPaths(),
		remixPWA(),
	],
});
