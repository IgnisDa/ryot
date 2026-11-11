import { BunServices } from "@effect/platform-bun";
import type { PluginClientCompilerPackageInput } from "@ryot-app/plugin-client-compiler";
import {
	clientPluginCompilationFailure,
	clientPluginCompilerDiagnostic,
	PluginClientCompilerFailure,
} from "@ryot-app/plugin-client-compiler/diagnostics";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "@ryot-app/plugin-client-compiler/limits";
import {
	decodeClientCompilerWorkerResponse,
	encodeClientCompilerWorkerRequest,
} from "@ryot-app/plugin-client-compiler/protocol";
import { PageClientArtifact } from "@ryot-app/plugin-client-contract";
import { Context, Effect, FileSystem, Layer, Match, Path, Schema, Semaphore } from "effect";

import {
	type CompilerWorkerFailure,
	makeCompilerWorkerRunner,
} from "#platform/process/compiler-worker";

const processFailure = (code: string, message: string) =>
	clientPluginCompilationFailure([clientPluginCompilerDiagnostic(code, "client", message)]);

const workerFailure = Match.type<CompilerWorkerFailure>().pipe(
	Match.tag("Timeout", () =>
		processFailure(
			"RYOT_CLIENT_COMPILER_TIMEOUT",
			`Client plugin compilation timed out after ${CLIENT_PLUGIN_COMPILER_LIMITS.timeoutMs}ms`,
		),
	),
	Match.tag("MemoryExceeded", () =>
		processFailure(
			"RYOT_CLIENT_COMPILER_MEMORY",
			`Client plugin compiler exceeded ${CLIENT_PLUGIN_COMPILER_LIMITS.memoryBytes} bytes of proportional memory`,
		),
	),
	Match.tag("MemorySupervisionFailed", () =>
		processFailure(
			"RYOT_CLIENT_COMPILER_MEMORY",
			"Client plugin compiler memory supervision became unavailable",
		),
	),
	Match.tag("ProcessExited", () =>
		processFailure(
			"RYOT_CLIENT_COMPILER_PROCESS",
			"Client plugin compiler process exited before returning a result",
		),
	),
	Match.tag("ProcessUnavailable", () =>
		processFailure(
			"RYOT_CLIENT_COMPILER_PROCESS",
			"Client plugin compiler process could not be started or read",
		),
	),
	Match.tag("OutputExceeded", () =>
		processFailure(
			"RYOT_CLIENT_COMPILER_PROCESS",
			"Client plugin compiler process returned an oversized result",
		),
	),
	Match.exhaustive,
);

const CLIENT_COMPILER_STDOUT_BYTES =
	Math.ceil(CLIENT_PLUGIN_COMPILER_LIMITS.artifactBytes / 3) * 4 +
	CLIENT_PLUGIN_COMPILER_LIMITS.diagnosticCount *
		CLIENT_PLUGIN_COMPILER_LIMITS.diagnosticMessageCharacters +
	64 * 1024;

export class ClientPluginCompiler extends Context.Service<ClientPluginCompiler>()(
	"@ryot-app/kernel-backend/modules/pages/compiler/ClientPluginCompiler",
	{
		make: Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const semaphore = yield* Semaphore.make(CLIENT_PLUGIN_COMPILER_LIMITS.concurrency);
			const current = new URL(import.meta.url);
			const currentPath = yield* path.fromFileUrl(current).pipe(Effect.orDie);
			const workerPath = currentPath.endsWith(".ts")
				? Bun.resolveSync("@ryot-app/plugin-client-compiler/worker", currentPath)
				: yield* path
						.fromFileUrl(new URL("./plugin-client-compiler-worker.js", current))
						.pipe(Effect.orDie);
			const runWorker = yield* makeCompilerWorkerRunner({
				semaphore,
				path: workerPath,
				failure: workerFailure,
				stdoutBytes: CLIENT_COMPILER_STDOUT_BYTES,
				timeoutMs: CLIENT_PLUGIN_COMPILER_LIMITS.timeoutMs,
				memoryBytes: CLIENT_PLUGIN_COMPILER_LIMITS.memoryBytes,
				memoryPollIntervalMs: CLIENT_PLUGIN_COMPILER_LIMITS.memoryPollIntervalMs,
			});

			const compile = Effect.fn("ClientPluginCompiler.compile")(function* (
				input: Extract<PluginClientCompilerPackageInput, { readonly kind: "page" }>,
			) {
				const workspaceParentPath = yield* fs
					.makeTempDirectoryScoped({
						prefix: "ryot-client-compiler-",
						directory: path.dirname(
							Bun.resolveSync("@ryot-app/plugin-client-compiler", currentPath),
						),
					})
					.pipe(Effect.orDie);
				const workspaceJobId = "build";
				return yield* encodeClientCompilerWorkerRequest({
					input,
					workspaceJobId,
					workspaceParentPath,
				}).pipe(
					Effect.mapError(() =>
						processFailure(
							"RYOT_CLIENT_COMPILER_INPUT",
							"Client compiler request could not be encoded",
						),
					),
					Effect.flatMap(runWorker),
					Effect.flatMap((output) =>
						decodeClientCompilerWorkerResponse(output).pipe(
							Effect.mapError(() =>
								processFailure(
									"RYOT_CLIENT_COMPILER_PROCESS",
									"Client plugin compiler process returned an invalid result",
								),
							),
						),
					),
					Effect.flatMap((response) =>
						response.success
							? Schema.decodeUnknownEffect(PageClientArtifact)(response.value.artifact).pipe(
									Effect.mapError(() =>
										processFailure(
											"RYOT_CLIENT_COMPILER_PROCESS",
											"Compiler returned an invalid page artifact",
										),
									),
								)
							: Effect.fail(
									new PluginClientCompilerFailure({
										message: response.error.message,
										diagnostics: response.error.diagnostics,
									}),
								),
					),
				);
			});

			return {
				compile: (input: Extract<PluginClientCompilerPackageInput, { readonly kind: "page" }>) =>
					Effect.scoped(compile(input)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(BunServices.layer));
}
