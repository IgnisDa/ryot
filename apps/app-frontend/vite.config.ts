import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const config = defineConfig({
	server: { host: true, port: 3005, strictPort: true, allowedHosts: true },
	plugins: [
		devtools(),
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		tanstackStart(),
		viteReact({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
	],
});

export default config;
