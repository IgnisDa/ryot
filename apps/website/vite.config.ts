import { vitePlugin as remix } from "@remix-run/dev";
import { remixRoutes } from "remix-routes/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

declare module "@remix-run/server-runtime" {
	interface Future {
		v3_singleFetch: true;
	}
}

export default defineConfig({
	plugins: [
		remix({
			future: {
				v3_singleFetch: true,
				v3_fetcherPersist: true,
				v3_throwAbortReason: true,
				v3_relativeSplatPath: true,
			},
		}),
		remixRoutes(),
		tsconfigPaths(),
	],
});
