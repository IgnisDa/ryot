import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig((_conf) => {
	return {
		define: { "import.meta.env.RYOT_VERSION": JSON.stringify(process.env["RYOT_VERSION"]) },
		plugins: [
			devtools(),
			tailwindcss(),
			tanstackRouter({ target: "react", autoCodeSplitting: true }),
			viteReact(),
		],
		resolve: {
			tsconfigPaths: true,
			alias: [
				{
					find: /^@formatjs\/icu-messageformat-parser$/,
					replacement: "@formatjs/icu-messageformat-parser/no-parser.js",
				},
			],
		},
		server: {
			cors: true,
			allowedHosts: true,
			proxy: {
				"^/(?:api|\\.well-known)(?:/|$)": {
					ws: true,
					changeOrigin: true,
					target: "http://localhost:3000",
				},
			},
		},
	};
});

export default config;
