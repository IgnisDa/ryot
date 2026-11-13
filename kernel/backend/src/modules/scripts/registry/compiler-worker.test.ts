import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { makeSandboxCompilerSupervisor } from "@ryot-app/plugin-backend-compiler/supervisor";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, FileSystem, Path } from "effect";

import { makeSandboxCompiler } from "./compiler";
import { validSandboxSource } from "./compiler.test-support";

layer(BunServices.layer, { excludeTestServices: true })((test) => {
	test.effect(
		"builds and serves jobs from the standalone production compiler worker",
		() =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const nodeModules = yield* path.fromFileUrl(
					new URL("../../../../node_modules/", import.meta.url),
				);
				const outputDirectory = yield* fs.makeTempDirectoryScoped({
					directory: nodeModules,
					prefix: "plugin-backend-compiler-worker-",
				});
				const build = yield* Effect.promise(() =>
					Bun.build({
						target: "bun",
						outdir: outputDirectory,
						external: ["@ryot-app/vite-compiler"],
						entrypoints: [
							Bun.resolveSync("@ryot-app/plugin-backend-compiler/worker", import.meta.url),
						],
					}),
				);
				expect(build.success).toBe(true);
				const workerPath = build.outputs[0]?.path;
				assert(workerPath);
				const compiler = yield* makeSandboxCompilerSupervisor({ workerPath });

				for (const _ of [1, 2]) {
					const compiled = yield* compiler.compile(validSandboxSource);
					expect(compiled.manifest).toMatchObject({ slug: "plain-value" });
					expect(compiled.javascript).toContain("sourceMappingURL=data:application/json;base64,");
				}
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"removes job workspaces after success and compilation failure",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const workspaceDirectory = yield* fs.makeTempDirectoryScoped({
					prefix: "plugin-backend-compiler-parent-",
				});
				const compiler = yield* makeSandboxCompiler(workspaceDirectory);

				yield* compiler.compile(validSandboxSource);
				yield* compiler.compile("export default ;").pipe(Effect.flip);

				const [poolDirectory, ...others] = yield* fs.readDirectory(workspaceDirectory);
				assert(poolDirectory !== undefined);
				expect(others).toEqual([]);
				expect(yield* fs.readDirectory(path.join(workspaceDirectory, poolDirectory))).toEqual([]);
			}).pipe(Effect.scoped),
		testTimeout,
	);
});
