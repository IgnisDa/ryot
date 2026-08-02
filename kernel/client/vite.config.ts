import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig((_conf) => {
	return {
		resolve: { tsconfigPaths: true },
		plugins: [
			devtools(),
			tailwindcss(),
			tanstackRouter({ target: "react", autoCodeSplitting: true }),
			viteReact(),
		],
		server: {
			cors: true,
			allowedHosts: true,
			proxy: { "/api": { ws: true, changeOrigin: true, target: "http://localhost:3000" } },
		},
	};
});

export default config;
