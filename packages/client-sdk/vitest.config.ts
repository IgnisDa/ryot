import shared from "@ryot/testing/vitest.shared";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, mergeConfig } from "vitest/config";

const config = defineConfig({
	plugins: [viteReact()],
	test: { environment: "jsdom" },
});

export default mergeConfig(shared, config);
