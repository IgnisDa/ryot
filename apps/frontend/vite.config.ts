import { remixPWA } from "@remix-pwa/dev";
import { vitePlugin as remix } from "@remix-run/dev";
import { remixDevTools } from "remix-development-tools";
import { remixRoutes } from "remix-routes/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

declare module "@remix-run/server-runtime" {
	interface Future {
		v3_singleFetch: true;
	}
}

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
			future: {
				v3_singleFetch: true,
				v3_fetcherPersist: true,
				v3_throwAbortReason: true,
				v3_relativeSplatPath: true,
				v3_lazyRouteDiscovery: true,
			},
		}),
		remixRoutes(),
		tsconfigPaths(),
		remixPWA(),
	],
});
