import { BunServices } from "@effect/platform-bun";
import { CompilerWorkerResponse } from "@ryot-app/sandbox-compiler/protocol";
import { Effect, Schema, Stream, FileSystem, Path } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { assert, expect, it } from "vitest";

import { validSandboxSource } from "./sandbox-compiler-test-support";

const decodeWorkerResponse = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CompilerWorkerResponse),
);

it("builds and executes the standalone production compiler worker", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
				const nodeModules = yield* path.fromFileUrl(
					new URL("../../../node_modules/", import.meta.url),
				);
				const outputDirectory = yield* fs.makeTempDirectoryScoped({
					directory: nodeModules,
					prefix: "sandbox-compiler-worker-",
				});
				const entrypoint = Bun.resolveSync("@ryot-app/sandbox-compiler/worker", import.meta.url);
				const build = yield* Effect.tryPromise(() =>
					Bun.build({ target: "bun", outdir: outputDirectory, entrypoints: [entrypoint] }),
				);
				expect(build.success).toBe(true);
				const workerPath = build.outputs[0]?.path;
				assert(workerPath);

				const command = ChildProcess.make(
					process.execPath,
					["--smol", "--no-install", workerPath],
					{
						stdout: "pipe",
						stderr: "pipe",
						stdin: Stream.succeed(new TextEncoder().encode(validSandboxSource)),
					},
				);
				const worker = yield* spawner.spawn(command);
				yield* Effect.addFinalizer(() =>
					worker.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore),
				);
				const [stdout, stderr, exitCode] = yield* Effect.all(
					[
						worker.stdout.pipe(
							Stream.decodeText({ encoding: "utf-8" }),
							Stream.runFold(
								() => "",
								(a, b) => a + b,
							),
						),
						worker.stderr.pipe(
							Stream.decodeText({ encoding: "utf-8" }),
							Stream.runFold(
								() => "",
								(a, b) => a + b,
							),
						),
						worker.exitCode,
					],
					{ concurrency: "unbounded" },
				);
				expect(exitCode, stderr).toBe(0);
				const response = yield* decodeWorkerResponse(stdout);
				assert(response.success);
				expect(response.value.manifest).toMatchObject({ slug: "plain-value" });
				expect(response.value.javascript).toContain(
					"sourceMappingURL=data:application/json;base64,",
				);
			}).pipe(Effect.provide(BunServices.layer)),
		),
	));
