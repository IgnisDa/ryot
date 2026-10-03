import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { bundleSandboxPackage } from "./compiler-bundle";
import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";
import { sandboxCompilerPlatformLayer } from "./compiler-platform";

it.layer(sandboxCompilerPlatformLayer)("bundleSandboxPackage", (test) => {
	test.effect("uses a scoped addressed workspace for multiple sandbox entries", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const parentPath = yield* fs.makeTempDirectoryScoped({ prefix: "sandbox-bundle-test-" });
				const jobId = "direct-call";
				const dependencies = yield* resolveSandboxCompilerDependencies;
				const modules = yield* bundleSandboxPackage(
					{ "entry.ts": "export default 42;", "second.ts": "export default 7;" },
					["entry.ts", "second.ts"],
					dependencies.sdkEntries,
					2,
					{ jobId, parentPath },
				);
				expect(modules.map(({ entry }) => entry)).toEqual(["entry.ts", "second.ts"]);
				expect(yield* fs.exists(path.join(parentPath, jobId))).toBe(false);
			}),
		),
	);

	test.effect("audits Bun references from emitted code", () =>
		Effect.gen(function* () {
			const dependencies = yield* resolveSandboxCompilerDependencies;
			const failure = yield* Effect.flip(
				bundleSandboxPackage(
					{ "entry.ts": "declare const Bun: { version: string }; export default Bun.version;" },
					["entry.ts"],
					dependencies.sdkEntries,
					1,
				),
			);
			expect(failure.diagnostics).toEqual([
				expect.objectContaining({
					code: "RYOT_BUNDLE",
					message: expect.stringContaining("forbidden CommonJS, Bun, or browser helper"),
				}),
			]);
		}),
	);
});
