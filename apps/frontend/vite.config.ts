import { reactRouter } from "@react-router/dev/vite";
import { reactRouterDevTools } from "react-router-devtools";
import { safeRoutes } from "safe-routes/vite";
import { defineConfig } from "vite";
import { VitePWA, defaultInjectManifestVitePlugins } from "vite-plugin-pwa";
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
		VitePWA({
			srcDir: "app",
			manifest: false,
			injectRegister: "auto",
			filename: "entry.worker.ts",
			strategies: "injectManifest",
			devOptions: { enabled: true, type: "module" },
			injectManifest: {
				vitePlugins: defaultInjectManifestVitePlugins.concat(
					"vite-tsconfig-paths",
				),
			},
		}),
	],
});
