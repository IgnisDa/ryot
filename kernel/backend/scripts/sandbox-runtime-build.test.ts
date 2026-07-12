import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { auditDenoEsmOutput, resolveSandboxRuntimeRegistry } from "./sandbox-runtime-build";

it.effect("derives trusted runtime versions and filenames from installed manifests", () =>
	Effect.gen(function* () {
		const dependencies = yield* resolveSandboxRuntimeRegistry(Bun.fileURLToPath(import.meta.url));
		expect(
			dependencies.map(({ name, version, runtimeFile }) => ({ name, version, runtimeFile })),
		).toEqual([
			{ name: "effect", version: "4.0.0-rc.111", runtimeFile: "effect-4.0.0-rc.111.mjs" },
			{ name: "cheerio", version: "1.2.0", runtimeFile: "cheerio-1.2.0.mjs" },
			{ name: "youtubei", version: "17.2.0", runtimeFile: "youtubei-17.2.0.mjs" },
			{ name: "fflate", version: "0.8.3", runtimeFile: "fflate-0.8.3.mjs" },
			{ version: "5.5.3", name: "papaparse", runtimeFile: "papaparse-5.5.3.mjs" },
			{ version: "5.8.0", name: "fast-xml-parser", runtimeFile: "fast-xml-parser-5.8.0.mjs" },
			{ name: "ryotql", version: "workspace", runtimeFile: "ryotql-workspace.mjs" },
		]);
	}).pipe(Effect.provide(BunServices.layer)),
);

it.effect("audits Deno ESM imports and runtime helpers", () =>
	Effect.gen(function* () {
		yield* auditDenoEsmOutput(
			'import { Effect } from "@ryot-app/sandbox-sdk/effect"; export { Effect };',
			new Set(["@ryot-app/sandbox-sdk/effect"]),
		);
		for (const source of [
			'import "node:fs";',
			'import "bun:test";',
			'import "https://example.com/module.ts";',
			'const dependency = import("https://example.com/dynamic.ts");',
			'import "unknown-package";',
			'const value = require("effect");',
			"const value = __vite_browser_external;",
		]) {
			const failure = yield* Effect.flip(auditDenoEsmOutput(source, new Set()));
			expect(failure._tag).toBe("SandboxRuntimeBuildError");
		}
	}),
);
