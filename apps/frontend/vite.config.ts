import { unstable_RemixPWA as remixPwa } from "@remix-pwa/dev";
import { unstable_vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [
		remix({ ignoredRouteFiles: ["**/.*"] }),
		tsconfigPaths(),
		remixPwa({}),
	],
});
