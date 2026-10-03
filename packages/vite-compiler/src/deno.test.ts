import { fileURLToPath } from "node:url";

import { BunFileSystem } from "@effect/platform-bun";
import { describe, expect, it, layer } from "@effect/vitest";
import { Effect, Layer, Result } from "effect";

import { auditDenoEsmOutput, buildDenoEsm, buildDenoEsmPackage, ViteBuildService } from "./index";
import { FakeViteBuild, fakeViteBuildLayer } from "./vite-build.test-support";

const liveLayer = Layer.merge(BunFileSystem.layer, ViteBuildService.layer);
const fakeLayer = (fileName: string) =>
	Layer.merge(
		BunFileSystem.layer,
		fakeViteBuildLayer(() => Effect.succeed(emitted(fileName))),
	);

const emitted = (fileName: string, code = "export const value = 1;") => ({
	output: [{ code, fileName, type: "chunk" }],
});

describe("Deno ESM audit", () => {
	it.effect.each([
		['import value from "node:path";', "forbidden runtime import"],
		['import value from "unknown";', "unapproved external import"],
		['export { value } from "unknown";', "unapproved external import"],
		['export * from "bun:test";', "forbidden runtime import"],
		['await import("npm:effect");', "forbidden runtime import"],
		['await import ("node:path");', "forbidden runtime import"],
		["await import(`node:path`);", "forbidden runtime import"],
		["await import(specifier);", "non-literal dynamic import"],
		['import "jsr:@std/path";', "forbidden runtime import"],
		['import "https://example.com/a.ts";', "forbidden runtime import"],
		["const value = require('x');", "forbidden runtime helper"],
		["const value = __require('x');", "forbidden runtime helper"],
		["const value = Bun.file('x');", "forbidden runtime helper"],
		['const start = "/*"; Bun.file("x"); const end = "*/";', "forbidden runtime helper"],
		["const value = __vite_browser_external;", "forbidden runtime helper"],
		["__vitePreload(() => import('approved'));", "forbidden runtime helper"],
		["document.getElementsByTagName('link');", "forbidden runtime helper"],
		['new Event("vite:preloadError");', "forbidden runtime helper"],
		["new Event(`vite:preloadError`);", "forbidden runtime helper"],
		['new Event("vite:\\x70reloadError");', "forbidden runtime helper"],
	] as const)("rejects %s", ([javascript, message]) =>
		Effect.sync(() => {
			const result = auditDenoEsmOutput(javascript, new Set(["approved"]));
			expect(Result.isFailure(result) && result.failure.message).toContain(message);
		}),
	);

	it.effect("allows approved imports and ignores comments, strings, and source-map text", () =>
		Effect.sync(() => {
			expect(
				auditDenoEsmOutput(
					[
						'import value from "approved";',
						'await import("approved");',
						'const text = \'Bun require("ignored") import("node:path") /*\';',
						'const eventName = "vite:preloadError";',
						'// Bun.file("ignored")',
						'/* document.getElementsByTagName("ignored") */',
						'//# sourceMappingURL=data:require("ignored")',
					].join("\n"),
					new Set(["approved"]),
				),
			).toEqual(Result.succeed(undefined));
		}),
	);

	it.effect("allows only explicitly approved non-literal dynamic import expressions", () =>
		Effect.sync(() => {
			expect(
				auditDenoEsmOutput(
					"await import(payload.moduleUrl);",
					new Set(),
					new Set(["payload.moduleUrl"]),
				),
			).toEqual(Result.succeed(undefined));
			const rejected = auditDenoEsmOutput(
				"await import(other.moduleUrl);",
				new Set(),
				new Set(["payload.moduleUrl"]),
			);
			expect(Result.isFailure(rejected) && rejected.failure.message).toContain(
				"non-literal dynamic import",
			);
		}),
	);
});

describe("Deno ESM build", () => {
	layer(fakeLayer("module.mjs"))((test) => {
		test.effect("owns the protected ES2022 unminified single-module profile", () =>
			Effect.gen(function* () {
				yield* buildDenoEsm({
					entry: "entry.ts",
					outputFile: "module.mjs",
					approvedExternalSpecifiers: new Set(["effect"]),
					sources: [{ path: "entry.ts", contents: "export const value = 1;" }],
					aliases: [{ find: /^effect$/, replacement: "/packages/effect/index.js" }],
				});
				const [config] = yield* (yield* FakeViteBuild).builds;
				expect(config?.resolve).toMatchObject({
					mainFields: ["browser", "module", "jsnext:main", "jsnext", "main"],
					conditions: ["deno", "worker", "browser", "import", "module", "default"],
				});
				expect(config?.define).toEqual({ "globalThis.Bun": "undefined" });
				expect(config?.build).toMatchObject({
					minify: false,
					target: "es2022",
					cssCodeSplit: false,
					sourcemap: "inline",
					modulePreload: false,
				});
				expect(config?.build?.rolldownOptions).toMatchObject({
					preserveEntrySignatures: "strict",
					output: { format: "es", codeSplitting: false, entryFileNames: "module.mjs" },
				});
				expect(config?.build?.lib).toMatchObject({ formats: ["es"] });
			}),
		);
	});

	layer(fakeLayer("runtime.mjs"))((test) => {
		test.effect(
			"uses external entries directly and normalizes stable distinct source-map paths",
			() =>
				Effect.gen(function* () {
					const result = yield* buildDenoEsm({
						outputFile: "runtime.mjs",
						entry: "/trusted/package/index.js",
						approvedExternalSpecifiers: new Set(),
					});
					const [config] = yield* (yield* FakeViteBuild).builds;
					const entry =
						config?.build?.lib && !Array.isArray(config.build.lib) ? config.build.lib.entry : "";
					expect(entry).toBe("/trusted/package/index.js");
					const transform = config?.build?.rolldownOptions?.output;
					const output = Array.isArray(transform) ? transform[0] : transform;
					const normalize = output?.sourcemapPathTransform;
					expect(normalize?.("../source/nested/entry.ts", "")).toBe("nested/entry.ts");
					expect(normalize?.("../generated/entry.ts", "")).toBe("ryot:generated/entry.ts");
					expect(normalize?.("/one/node_modules/package-a/index.js", "")).toBe(
						"ryot:external/package-a/index.js",
					);
					expect(normalize?.("/two/node_modules/package-b/index.js", "")).toBe(
						"ryot:external/package-b/index.js",
					);
					expect(normalize?.("/one/node_modules/package-a/index.js", "")).toBe(
						normalize?.("/other/node_modules/package-a/index.js", ""),
					);
					const firstIndex = normalize?.("/trusted/first/index.js", "");
					const secondIndex = normalize?.("/trusted/second/index.js", "");
					expect(firstIndex).not.toBe(secondIndex);
					expect(normalize?.("/trusted/first/index.js", "")).toBe(firstIndex);
					expect(result).toEqual({ diagnostics: [], javascript: "export const value = 1;" });
				}),
		);
	});

	layer(liveLayer)((test) => {
		test.effect("preserves executable named and default exports from an external entry", () =>
			Effect.gen(function* () {
				const result = yield* buildDenoEsm({
					outputFile: "default-entry.mjs",
					approvedExternalSpecifiers: new Set(),
					entry: fileURLToPath(new URL("./fixtures/default-entry.mjs", import.meta.url)),
				});
				const module = yield* Effect.promise(
					() =>
						import(
							`data:text/javascript;base64,${Buffer.from(result.javascript).toString("base64")}`
						),
				);
				expect(module.named).toBe("named");
				expect(module.default()).toBe("default");
			}),
		);
	});

	layer(fakeLayer("extra.mjs"))((test) => {
		test.effect("rejects unsafe staged entries, unexpected outputs, and audited output", () =>
			Effect.gen(function* () {
				const common = {
					outputFile: "module.mjs",
					approvedExternalSpecifiers: new Set<string>(),
					sources: [{ path: "entry.ts", contents: "export {};" }],
				};
				const unsafe = yield* Effect.flip(buildDenoEsm({ ...common, entry: "../entry.ts" }));
				expect(unsafe.reason).toBe("invalid-input");
				const unexpected = yield* Effect.flip(buildDenoEsm({ ...common, entry: "entry.ts" }));
				expect(unexpected.reason).toBe("invalid-output");
				yield* (yield* FakeViteBuild).respondWith(() =>
					Effect.succeed(emitted("module.mjs", 'import "node:path";')),
				);
				const audited = yield* Effect.flip(buildDenoEsm({ ...common, entry: "entry.ts" }));
				expect(audited.reason).toBe("invalid-output");
				expect(audited.diagnostics?.[0]?.message).toContain("forbidden runtime import");
			}),
		);
	});

	layer(liveLayer)((test) => {
		test.effect("builds staged TypeScript with an inline source map", () =>
			Effect.gen(function* () {
				const result = yield* buildDenoEsm({
					entry: "nested/entry.ts",
					outputFile: "module.mjs",
					approvedExternalSpecifiers: new Set(),
					sources: [{ path: "nested/entry.ts", contents: "export const value: number = 1;" }],
				});
				expect(result.diagnostics).toEqual([]);
				expect(result.javascript).toContain("export { value }");
				expect(result.javascript).toContain("//# sourceMappingURL=data:application/json;base64,");
			}),
		);
		test.effect("omits trusted dependency maps while preserving their executable exports", () =>
			Effect.gen(function* () {
				const result = yield* buildDenoEsm({
					sourceMap: false,
					outputFile: "runtime.mjs",
					approvedExternalSpecifiers: new Set(),
					entry: fileURLToPath(new URL("./fixtures/default-entry.mjs", import.meta.url)),
				});
				expect(result.javascript).not.toContain("sourceMappingURL");
				const module = yield* Effect.promise(
					() =>
						import(
							`data:text/javascript;base64,${Buffer.from(result.javascript).toString("base64")}`
						),
				);
				expect(module.named).toBe("named");
				expect(module.default()).toBe("default");
			}),
		);
	});
});

describe("Deno ESM package build", () => {
	const packageSources = [
		{ path: "shared/value.ts", contents: "export const value: number = 1;" },
		{ path: "first/entry.ts", contents: 'export { value as first } from "../shared/value";' },
		{ path: "second/entry.ts", contents: 'export { value as second } from "../shared/value";' },
	];

	layer(fakeLayer("module.mjs"))((test) => {
		test.effect("stages the package once and builds every entry against it", () =>
			Effect.gen(function* () {
				const modules = yield* buildDenoEsmPackage({
					concurrency: 2,
					sources: packageSources,
					outputFile: "module.mjs",
					approvedExternalSpecifiers: new Set(),
					entries: ["first/entry.ts", "second/entry.ts"],
				});
				expect(modules.map(({ entry }) => entry)).toEqual(["first/entry.ts", "second/entry.ts"]);
				const builds = yield* (yield* FakeViteBuild).builds;
				expect(builds).toHaveLength(2);
				expect(new Set(builds.map(({ root }) => root)).size).toBe(1);
			}),
		);
	});

	layer(liveLayer)((test) => {
		test.effect("emits one audited module per entry and rejects unsafe entries", () =>
			Effect.gen(function* () {
				const modules = yield* buildDenoEsmPackage({
					sources: packageSources,
					outputFile: "module.mjs",
					approvedExternalSpecifiers: new Set(),
					entries: ["first/entry.ts", "second/entry.ts"],
				});
				expect(modules[0]?.javascript).toContain("export { value as first }");
				expect(modules[1]?.javascript).toContain("export { value as second }");
				for (const module of modules) {
					expect(module.diagnostics).toEqual([]);
					expect(module.javascript).toContain("//# sourceMappingURL=data:application/json;base64,");
				}
				const unsafe = yield* Effect.flip(
					buildDenoEsmPackage({
						sources: packageSources,
						outputFile: "module.mjs",
						entries: ["../first/entry.ts"],
						approvedExternalSpecifiers: new Set(),
					}),
				);
				expect(unsafe.reason).toBe("invalid-input");
			}),
		);
	});
});
