/* oxlint-disable perfectionist/sort-objects -- StyleX layer declarations are ordered for clarity. */
import { fileURLToPath } from "node:url";

import stylex from "@stylexjs/unplugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const stylexTracerEnabled = process.env.RYOT_STYLEX_TRACER === "1";

const stylexTracerPlugins = stylexTracerEnabled
	? [
			stylex({
				devMode: "full",
				runtimeInjection: false,
				useCSSLayers: {
					before: ["theme", "base", "components", "utilities"],
					prefix: "ryot-stylex-tracer",
				},
				unstable_moduleResolution: {
					type: "commonJS",
					rootDir: repositoryRoot,
					themeFileExtension: ".stylex",
				},
			}),
		]
	: [];

const config = defineConfig((_conf) => {
	return {
		define: { __RYOT_STYLEX_TRACER__: JSON.stringify(stylexTracerEnabled) },
		resolve: { tsconfigPaths: true },
		server: {
			cors: true,
			allowedHosts: true,
			proxy: { "/api": { ws: true, changeOrigin: true, target: "http://localhost:3000" } },
		},
		plugins: [
			...stylexTracerPlugins,
			devtools(),
			tailwindcss(),
			tanstackRouter({ target: "react", autoCodeSplitting: true }),
			viteReact(),
		],
	};
});

export default config;
