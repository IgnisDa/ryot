import { reactRouter } from "@react-router/dev/vite";
import { remixPWA } from "@remix-pwa/dev";
import { reactRouterDevTools } from "react-router-devtools";
import { safeRoutes } from "safe-routes/vite";
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
		reactRouterDevTools(),
		reactRouter(),
		safeRoutes(),
		tsconfigPaths({ ignoreConfigErrors: true }),
		remixPWA(),
	],
});
