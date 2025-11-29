import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { safeRoutes } from "safe-routes/vite";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	server: { allowedHosts: true },
	plugins: [reactRouter(), safeRoutes(), tailwindcss()],
});
