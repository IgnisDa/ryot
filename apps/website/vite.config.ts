import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { safeRoutes } from "safe-routes/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	server: { allowedHosts: true },
	plugins: [
		reactRouter(),
		safeRoutes(),
		tailwindcss(),
		tsconfigPaths({ ignoreConfigErrors: true }),
	],
});
