import { FileSystem } from "@effect/platform";
import { BunFileSystem } from "@effect/platform-bun";
import { CompilerWorkerResponse } from "@ryot/sandbox-compiler/protocol";
import { Effect, Schema } from "effect";
import { assert, expect, it } from "vitest";

import { validSandboxSource } from "./compiler-test-support";

const decodeWorkerResponse = Schema.decode(Schema.parseJson(CompilerWorkerResponse));

it("builds and executes the standalone production compiler worker", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const nodeModules = Bun.fileURLToPath(new URL("../../../node_modules/", import.meta.url));
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

				const worker = Bun.spawn(
					[process.execPath, "--smol", "--no-install", `${outputDirectory}/compiler-worker.js`],
					{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
				);
				yield* Effect.tryPromise(() => Promise.resolve(worker.stdin.write(validSandboxSource)));
				yield* Effect.tryPromise(() => Promise.resolve(worker.stdin.end()));
				const [stdout, stderr, exitCode] = yield* Effect.tryPromise(() =>
					Promise.all([
						new Response(worker.stdout).text(),
						new Response(worker.stderr).text(),
						worker.exited,
					]),
				);
				expect(exitCode, stderr).toBe(0);
				const response = yield* decodeWorkerResponse(stdout);
				assert(response.success);
				expect(response.value.manifest).toMatchObject({ slug: "plain-value" });
				expect(response.value.javascript).toContain(
					"sourceMappingURL=data:application/json;base64,",
				);
			}).pipe(Effect.provide(BunFileSystem.layer)),
		),
	));
