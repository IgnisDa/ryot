import { fileURLToPath } from "node:url";

import shared from "@ryot-app/testing/vitest.shared";
import stylex from "@stylexjs/unplugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, mergeConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../../../../..", import.meta.url));

const stylexTestPlugin = stylex({
	dev: false,
	devMode: "css-only",
	runtimeInjection: false,
	useCSSLayers: { prefix: "ryot-stylex-tracer-test" },
	unstable_moduleResolution: {
		type: "commonJS",
		rootDir: repositoryRoot,
		themeFileExtension: ".stylex",
	},
});
// Tests need the official transform, but not the development CSS server or its polling interval.
stylexTestPlugin.configureServer = undefined;

const config = defineConfig({
	plugins: [stylexTestPlugin, viteReact()],
	test: {
		environment: "jsdom",
		setupFiles: ["./vitest.setup.ts"],
		include: ["src/routes/_authenticated/-stylex-tracer.tracer.tsx"],
	},
});

export default mergeConfig(shared, config);
