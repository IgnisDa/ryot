import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const config = defineConfig(({ mode }) => {
	const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };

	return {
		resolve: { tsconfigPaths: true },
		server: {
			allowedHosts: true,
			proxy: {
				"/api": {
					changeOrigin: true,
					target: env.RYOT_DEV_BACKEND_ORIGIN || "http://localhost:3000",
				},
			},
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
