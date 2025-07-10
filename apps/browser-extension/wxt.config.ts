import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
	outDir: "dist",
	webExt: { disabled: true },
	modules: ["@wxt-dev/module-react"],
	vite: () => ({
		plugins: [tailwindcss()],
	}),
	manifest: {
		permissions: ["storage"],
		name: "Ryot Browser Extension",
		host_permissions: ["<all_urls>"],
		description:
			"Automatically scrobble media that you are watching on various streaming services to your self-hosted Ryot tracker.",
	},
});
