import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Effect, FileSystem, Layer, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { bundleBuiltInScript } from "./compiler-bundle";
import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";

const testPlatformLayer = Layer.merge(BunServices.layer, ViteBuildService.layer);

it.effect("uses a scoped addressed workspace and emits executable Deno ESM", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const parentPath = yield* fs.makeTempDirectoryScoped({ prefix: "sandbox-bundle-test-" });
			const jobId = "direct-call";
			const dependencies = yield* resolveSandboxCompilerDependencies;
			const result = yield* bundleBuiltInScript(
				{ entry: "entry.ts", files: { "entry.ts": "export default 42;" } },
				dependencies.sdkEntries,
				{ jobId, parentPath },
			);
			expect(result.success).toBe(true);
			if (!result.success) {
				return;
			}
			expect(yield* fs.exists(path.join(parentPath, jobId))).toBe(false);

			const encoded = Buffer.from(result.javascript).toString("base64");
			const process = yield* spawner.spawn(
				ChildProcess.make(
					"deno",
					[
						"eval",
						`const module = await import("data:text/javascript;base64,${encoded}"); if (module.default !== 42) Deno.exit(1);`,
					],
					{ stdout: "pipe", stderr: "pipe" },
				),
			);
			const [exitCode, stderr] = yield* Effect.all([
				process.exitCode,
				process.stderr.pipe(Stream.decodeText({ encoding: "utf-8" }), Stream.runCollect),
			]);
			expect(exitCode, Array.from(stderr).join("")).toBe(0);
		}),
	).pipe(Effect.provide(testPlatformLayer)),
);

it.effect("audits Bun references from emitted code", () =>
	Effect.gen(function* () {
		const dependencies = yield* resolveSandboxCompilerDependencies;
		const result = yield* bundleBuiltInScript(
			{
				entry: "entry.ts",
				files: {
					"entry.ts": "declare const Bun: { version: string }; export default Bun.version;",
				},
			},
			dependencies.sdkEntries,
		);
		expect(result).toEqual({
			success: false,
			diagnostics: [
				expect.objectContaining({
					code: "RYOT_BUNDLE",
					message: expect.stringContaining("forbidden CommonJS, Bun, or browser helper"),
				}),
			],
		});
	}).pipe(Effect.provide(testPlatformLayer)),
);
