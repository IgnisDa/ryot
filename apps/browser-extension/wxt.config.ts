import { defineConfig } from "wxt";

export default defineConfig({
	outDir: "dist",
	webExt: { disabled: true },
	modules: ["@wxt-dev/module-react"],
});
