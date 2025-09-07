import { reactRouter } from "@react-router/dev/vite";
import { remixPWA } from "@remix-pwa/dev";
import { reactRouterDevTools } from "react-router-devtools";
import { safeRoutes } from "safe-routes/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	server: {
		host: process.env.FRONTEND_HOST,
		port: process.env.FRONTEND_PORT
			? Number.parseInt(process.env.FRONTEND_PORT)
			: undefined,
	},
	plugins: [
		reactRouterDevTools(),
		reactRouter(),
		safeRoutes(),
		tsconfigPaths({ ignoreConfigErrors: true }),
		remixPWA(),
	],
});
