import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
	resolve: { tsconfigPaths: true },
	server: { host: true, port: 3005, strictPort: true, allowedHosts: true },
	plugins: [devtools(), tanstackStart({ spa: { enabled: true } }), viteReact()],
});

export default config;
