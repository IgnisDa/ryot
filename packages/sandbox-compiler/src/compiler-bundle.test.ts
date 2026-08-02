import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Effect, FileSystem, Layer, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { bundleSandboxPackage } from "./compiler-bundle";
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
			const modules = yield* bundleSandboxPackage(
				{ "entry.ts": "export default 42;", "second.ts": "export default 7;" },
				["entry.ts", "second.ts"],
				dependencies.sdkEntries,
				2,
				{ jobId, parentPath },
			);
			expect(modules.map(({ entry }) => entry)).toEqual(["entry.ts", "second.ts"]);
			expect(yield* fs.exists(path.join(parentPath, jobId))).toBe(false);

			const encoded = Buffer.from(modules[0]?.javascript ?? "").toString("base64");
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
	}).pipe(Effect.provide(testPlatformLayer)),
);
