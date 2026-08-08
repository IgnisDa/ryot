import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig((_conf) => {
	return {
		resolve: { tsconfigPaths: true },
		server: {
			cors: true,
			allowedHosts: true,
			proxy: { "/api": { changeOrigin: true, target: "http://localhost:3000" } },
		},
		plugins: [
			devtools(),
			tailwindcss(),
			tanstackRouter({ target: "react", autoCodeSplitting: true }),
			viteReact(),
		],
	};
});

export default config;
