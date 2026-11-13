import {
	type CompilerJobFailure,
	CompilerWorkerUnavailable,
	makeCompilerWorkerPool,
} from "@ryot-app/compiler-worker/pool";
import { PageClientArtifact } from "@ryot-app/plugin-client-contract";
import { sanitizeEnvironment } from "@ryot-app/vite-compiler/environment";
import { Effect, Match, Path, Schema } from "effect";

import {
	clientPluginCompilationFailure,
	clientPluginCompilerDiagnostic,
	PluginClientCompilerFailure,
} from "./diagnostics";
import type { PluginClientCompilerPackageInput } from "./input";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";
import { decodeClientCompilerWorkerResponse, encodeClientCompilerWorkerRequest } from "./protocol";

const failure = (code: string, message: string) =>
	clientPluginCompilationFailure([clientPluginCompilerDiagnostic(code, "client", message)]);

const jobFailure = Match.type<CompilerJobFailure>().pipe(
	Match.when("Timeout", () =>
		failure(
			"RYOT_CLIENT_COMPILER_TIMEOUT",
			`Client plugin compilation timed out after ${CLIENT_PLUGIN_COMPILER_LIMITS.timeoutMs}ms`,
		),
	),
	Match.when("MemoryExceeded", () =>
		failure(
			"RYOT_CLIENT_COMPILER_MEMORY",
			`Client plugin compiler exceeded ${CLIENT_PLUGIN_COMPILER_LIMITS.memoryBytes} bytes of proportional memory`,
		),
	),
	Match.when("OutputExceeded", () =>
		failure("RYOT_CLIENT_COMPILER_PROCESS", "Client plugin compiler returned an oversized result"),
	),
	Match.exhaustive,
);

const decodeArtifact = Schema.decodeUnknownEffect(PageClientArtifact);

const invalidResult = new CompilerWorkerUnavailable({
	message: "The client plugin compiler worker returned an invalid result",
});

export type ClientCompilerSupervisorOptions = {
	readonly workerPath: string;
	readonly verifyEnvironment?: boolean;
};

export const makeClientCompilerSupervisor = Effect.fnUntraced(function* (
	options: ClientCompilerSupervisorOptions,
) {
	const path = yield* Path.Path;
	const env = yield* Effect.fromResult(sanitizeEnvironment({ includePath: true })).pipe(
		Effect.orDie,
	);
	const pool = yield* makeCompilerWorkerPool({
		env,
		jobFailure,
		label: "client-compiler",
		path: options.workerPath,
		size: CLIENT_PLUGIN_COMPILER_LIMITS.concurrency,
		timeoutMs: CLIENT_PLUGIN_COMPILER_LIMITS.timeoutMs,
		memoryBytes: CLIENT_PLUGIN_COMPILER_LIMITS.memoryBytes,
		outputBytes: CLIENT_PLUGIN_COMPILER_LIMITS.responseBytes,
		idleTimeoutMs: CLIENT_PLUGIN_COMPILER_LIMITS.idleTimeoutMs,
		startupTimeoutMs: CLIENT_PLUGIN_COMPILER_LIMITS.startupTimeoutMs,
		recycleMemoryBytes: CLIENT_PLUGIN_COMPILER_LIMITS.recycleMemoryBytes,
		goMemoryLimitBytes: CLIENT_PLUGIN_COMPILER_LIMITS.goMemoryLimitBytes,
		memoryPollIntervalMs: CLIENT_PLUGIN_COMPILER_LIMITS.memoryPollIntervalMs,
		// Workspaces stay beneath the compiler package so package resolution finds its dependencies.
		workspaceDirectory: path.dirname(
			Bun.resolveSync("@ryot-app/plugin-client-compiler", import.meta.dir),
		),
		...(options.verifyEnvironment === undefined
			? {}
			: { verifyEnvironment: options.verifyEnvironment }),
	});

	const compile = (input: Extract<PluginClientCompilerPackageInput, { readonly kind: "page" }>) =>
		Effect.gen(function* () {
			const output = yield* pool.run((job) =>
				encodeClientCompilerWorkerRequest({
					input,
					workspaceJobId: job.jobId,
					workspaceParentPath: job.parentPath,
				}).pipe(
					Effect.mapError(() =>
						failure("RYOT_CLIENT_COMPILER_INPUT", "Client compiler request could not be encoded"),
					),
				),
			);
			const response = yield* decodeClientCompilerWorkerResponse(output).pipe(
				Effect.mapError(() => invalidResult),
			);
			if (!response.success) {
				return yield* new PluginClientCompilerFailure({
					message: response.error.message,
					diagnostics: response.error.diagnostics,
				});
			}
			return yield* decodeArtifact(response.value.artifact).pipe(
				Effect.mapError(() => invalidResult),
			);
		});

	return { compile };
});
