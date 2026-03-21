import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { safeRoutes } from "safe-routes/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	server: { allowedHosts: true },
	plugins: [
		reactRouter(),
		// biome-ignore lint/suspicious/noExplicitAny: to satisfy the plugin's expected type
		safeRoutes() as any,
		tailwindcss(),
		tsconfigPaths({ ignoreConfigErrors: true }),
	],
});
