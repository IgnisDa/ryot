import { reactRouter } from "@react-router/dev/vite";
import { safeRoutes } from "safe-routes/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	server: {
		host: process.env.FRONTEND_HOST,
		port: process.env.FRONTEND_PORT
			? Number.parseInt(process.env.FRONTEND_PORT, 10)
			: undefined,
	},
	plugins: [
		reactRouter(),
		safeRoutes(),
		tsconfigPaths({ ignoreConfigErrors: true }),
		VitePWA({
			srcDir: "app",
			manifest: false,
			injectRegister: "script",
			filename: "entry.worker.ts",
			strategies: "injectManifest",
			devOptions: { enabled: true },
			injectManifest: { injectionPoint: undefined },
		}),
	],
});
