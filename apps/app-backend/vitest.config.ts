import { defineConfig, type Plugin } from "vitest/config";

const srcDir = new URL("./src/", import.meta.url).pathname;

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
		if (!id.endsWith(".sandbox.js")) {return;}
		return { code: `export default ${JSON.stringify(code)};`, map: null };
	},
};

export default defineConfig({
	plugins: [sandboxScriptTextPlugin],
	test: { include: ["src/**/*.test.ts"], setupFiles: ["./test-setup.ts"] },
	resolve: { alias: [{ find: /^#(lib|modules)\//, replacement: `${srcDir}$1/` }] },
});
