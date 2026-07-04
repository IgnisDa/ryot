import { Command, CommandExecutor, FileSystem, Path } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { CompilerWorkerResponse } from "@ryot/sandbox-compiler/protocol";
import { Effect, Schema, Stream } from "effect";
import { assert, expect, it } from "vitest";

import { validSandboxSource } from "./compiler-test-support";

const decodeWorkerResponse = Schema.decode(Schema.parseJson(CompilerWorkerResponse));

it("builds and executes the standalone production compiler worker", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const executor = yield* CommandExecutor.CommandExecutor;
				const nodeModules = yield* path.fromFileUrl(
					new URL("../../../node_modules/", import.meta.url),
				);
				const outputDirectory = yield* fs.makeTempDirectoryScoped({
					prefix: "sandbox-compiler-worker-",
					directory: nodeModules,
				});
				const entrypoint = Bun.resolveSync("@ryot/sandbox-compiler/worker", import.meta.url);
				const build = yield* Effect.tryPromise(() =>
					Bun.build({
						target: "bun",
						outdir: outputDirectory,
						entrypoints: [entrypoint],
					}),
				);
				expect(build.success).toBe(true);

				const command = Command.make(
					process.execPath,
					"--smol",
					"--no-install",
					`${outputDirectory}/compiler-worker.js`,
				).pipe(Command.feed(validSandboxSource), Command.stdout("pipe"), Command.stderr("pipe"));
				const worker = yield* executor.start(command);
				yield* Effect.addFinalizer(() => worker.kill("SIGKILL").pipe(Effect.ignore));
				const [stdout, stderr, exitCode] = yield* Effect.all(
					[
						worker.stdout.pipe(
							Stream.decodeText("utf-8"),
							Stream.runFold("", (a, b) => a + b),
						),
						worker.stderr.pipe(
							Stream.decodeText("utf-8"),
							Stream.runFold("", (a, b) => a + b),
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
			}).pipe(Effect.provide(BunContext.layer)),
		),
	));
