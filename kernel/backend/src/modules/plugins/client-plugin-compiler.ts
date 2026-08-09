import { BunServices } from "@effect/platform-bun";
import type { ClientPluginCompilerInput } from "@ryot-app/client-plugin-compiler";
import {
	ClientPluginCompilerFailure,
	clientPluginCompilationFailure,
	clientPluginCompilerDiagnostic,
} from "@ryot-app/client-plugin-compiler/diagnostics";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "@ryot-app/client-plugin-compiler/limits";
import {
	decodeClientCompilerWorkerResponse,
	encodeClientCompilerWorkerRequest,
} from "@ryot-app/client-plugin-compiler/protocol";
import { Context, Effect, Layer, Match, Path, Semaphore } from "effect";

import {
	type CompilerWorkerFailure,
	makeCompilerWorkerRunner,
} from "#lib/infrastructure/compiler-worker/runner";

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
	"ClientPluginCompiler",
	{
		make: Effect.gen(function* () {
			const path = yield* Path.Path;
			const semaphore = yield* Semaphore.make(CLIENT_PLUGIN_COMPILER_LIMITS.concurrency);
			const current = new URL(import.meta.url);
			const currentPath = yield* path.fromFileUrl(current).pipe(Effect.orDie);
			const workerPath = currentPath.endsWith(".ts")
				? Bun.resolveSync("@ryot-app/client-plugin-compiler/worker", currentPath)
				: yield* path
						.fromFileUrl(new URL("./client-plugin-compiler-worker.js", current))
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

			const compile = (request: ClientPluginCompilerInput) =>
				runWorker(encodeClientCompilerWorkerRequest(request)).pipe(
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
							? Effect.succeed(response.value.artifact)
							: Effect.fail(
									new ClientPluginCompilerFailure({
										message: response.error.message,
										diagnostics: response.error.diagnostics,
									}),
								),
					),
				);

			return { compile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(BunServices.layer));
}
