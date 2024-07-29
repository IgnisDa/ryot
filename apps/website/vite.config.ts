import { vitePlugin as remix } from "@remix-run/dev";
import { remixRoutes } from "remix-routes/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [
		remix({
			future: {
				unstable_singleFetch: true,
				v3_fetcherPersist: true,
				v3_relativeSplatPath: true,
				v3_throwAbortReason: true,
			},
		}),
		remixRoutes(),
		tsconfigPaths(),
	],
});
