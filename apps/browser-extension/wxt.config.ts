import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "wxt";

export default defineConfig({
	srcDir: "src",
	outDir: "dist",
	webExt: { disabled: true },
	modules: ["@wxt-dev/module-react", "@wxt-dev/auto-icons"],
	vite: () => ({
		plugins: [
			tailwindcss(),
			// FIXME: Remove when https://github.com/aleclarson/vite-tsconfig-paths/issues/176
			// biome-ignore lint/suspicious/noExplicitAny: remove when fixed
			tsconfigPaths() as any,
		],
	}),
	manifest: {
		permissions: ["storage"],
		name: "Ryot Browser Extension",
		host_permissions: ["<all_urls>"],
		description:
			"Automatically scrobble media that you are watching on various streaming services to your self-hosted Ryot tracker.",
	},
});
