import { vitePlugin as remix } from "@remix-run/dev";
import { remixDevTools } from "remix-development-tools";
import { remixRoutes } from "remix-routes/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [
		remixDevTools(),
		remix({
			future: { unstable_singleFetch: true },
		}),
		remixRoutes(),
		tsconfigPaths(),
	],
});
