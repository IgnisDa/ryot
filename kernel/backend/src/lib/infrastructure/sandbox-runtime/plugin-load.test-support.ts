import { BunServices } from "@effect/platform-bun";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { compilePluginSandboxSourceEntries } from "@ryot/sandbox-compiler/plugins";
import { sha256Hex } from "@ryot/ts-utils/crypto";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

import { loadPluginSource, PluginSourceError } from "#modules/plugins/source.test-support";

import { materializeSandboxCompiledModule } from "./compiled-modules";
import { ensureSandboxRuntimeDependencies } from "./dependencies";
import { SANDBOX_LIMITS, SANDBOX_RUNNER_LIMITS } from "./limits";
import { sandboxRunnerSource } from "./runner.generated";

const encodeRequest = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeResponse = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const decoder = new TextDecoder("utf-8", { fatal: true });

export const verifyPluginSandboxScriptsLoad = (packageRoot: string, manifest: PluginManifest) =>
	Effect.scoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-plugin-load-" });
			const runtime = yield* ensureSandboxRuntimeDependencies(root);
			const runnerPath = path.join(root, "runner.mjs");
			yield* fs.writeFileString(runnerPath, sandboxRunnerSource);
			yield* Effect.addFinalizer(() => fs.chmod(runtime.directory, 0o755).pipe(Effect.ignore));

			const source = yield* loadPluginSource(packageRoot, manifest);
			const backendFiles = Object.fromEntries(
				yield* Effect.forEach(
					Object.entries(source.files).filter(([filePath]) => filePath.startsWith("backend/")),
					([filePath, contents]) =>
						Effect.try({
							try: () => [filePath, decoder.decode(contents)] as const,
							catch: (error) => new PluginSourceError({ message: String(error) }),
						}),
				),
			);
			const outputs = yield* compilePluginSandboxSourceEntries(backendFiles, manifest.scripts);
			yield* Effect.forEach(
				outputs,
				({ compiled }) =>
					Effect.scoped(
						Effect.gen(function* () {
							const modulePath = yield* materializeSandboxCompiledModule(
								runtime,
								sha256Hex(compiled.javascript),
								compiled.javascript,
							);
							const moduleUrl = yield* path.toFileUrl(modulePath);
							const request = `${encodeRequest({
								context: {},
								token: "unused",
								scriptId: "script-1",
								moduleUrl: moduleUrl.href,
								executionId: "execution-1",
								metadata: compiled.manifest,
								apiBase: "http://127.0.0.1:1",
								limits: SANDBOX_RUNNER_LIMITS,
								compiledFormat: compiled.format,
								startedAt: "2026-08-06T00:00:00.000Z",
								apiFunctions: compiled.manifest.capabilities,
							})}\n`;
							const process = yield* ChildProcess.make(
								"deno",
								[
									"run",
									"--no-npm",
									"--no-lock",
									"--deny-run",
									"--deny-env",
									"--deny-ffi",
									"--no-prompt",
									"--no-config",
									"--no-remote",
									"--cached-only",
									"--allow-net=127.0.0.1:1",
									`--import-map=${runtime.importMapPath}`,
									`--v8-flags=--max-old-space-size=${SANDBOX_LIMITS.execution.denoHeapMiB}`,
									"--deny-write",
									`--allow-read=${runnerPath},${runtime.directory}`,
									runnerPath,
								],
								{
									stdin: Stream.succeed(new TextEncoder().encode(request)),
									stdout: "pipe",
									stderr: "pipe",
									extendEnv: false,
									env: {
										DENO_DIR: runtime.cacheDirectory,
										PATH: Bun.env["PATH"] ?? "/usr/bin:/bin",
									},
								},
							).pipe(
								Effect.mapError(
									(error) => new SandboxRunError({ message: unknownToMessage(error) }),
								),
							);
							const [stdout, stderr, exitCode] = yield* Effect.all(
								[
									process.stdout.pipe(
										Stream.decodeText(),
										Stream.runFold(
											() => "",
											(a, b) => a + b,
										),
									),
									process.stderr.pipe(
										Stream.decodeText(),
										Stream.runFold(
											() => "",
											(a, b) => a + b,
										),
									),
									process.exitCode,
								],
								{ concurrency: "unbounded" },
							);
							if (exitCode !== 0) {
								return yield* new SandboxRunError({
									message: `${compiled.manifest.slug}: ${stderr}`,
								});
							}
							const response = decodeResponse(stdout.trim());
							const error =
								response !== null && typeof response === "object"
									? Reflect.get(response, "error")
									: null;
							if (
								error !== null &&
								typeof error === "object" &&
								Reflect.get(error, "phase") === "load"
							) {
								return yield* new SandboxRunError({
									message: `${compiled.manifest.slug}: ${String(Reflect.get(error, "message"))}`,
								});
							}
							return yield* Effect.void;
						}),
					),
				{ concurrency: 5, discard: true },
			);
		}),
	).pipe(Effect.provide(BunServices.layer));
