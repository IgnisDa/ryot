import { defineConfig, type Plugin } from "vitest/config";

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

// TODO: Vite (vitest's transform layer) doesn't honor Bun's `with { type: "text" }` import
// attribute like `bun run`/`bun build` do, so `.sandbox.js` scripts get executed as real modules
// instead of inlined as text. This plugin can go away if we move the suite to `bun test`, which
// is blocked on native Bun support for `@effect/vitest`-style tests landing upstream:
// https://github.com/Effect-TS/effect/issues/5964
// https://github.com/Effect-TS/effect/pull/6236
const sandboxScriptTextPlugin: Plugin = {
	enforce: "pre",
	name: "sandbox-script-text",
	transform(code, id) {
		return id.endsWith(".sandbox.js")
			? { code: `export default ${JSON.stringify(code)};`, map: null }
			: undefined;
	},
};

export default defineConfig({
	plugins: [sandboxScriptTextPlugin],
	resolve: { alias: [{ find: /^#(lib|modules)\//, replacement: `${srcDir}$1/` }] },
	test: {
		testTimeout: 15000,
		reporters: ["agent"],
		include: ["src/**/*.test.ts"],
		setupFiles: ["./test-setup.ts"],
	},
});
