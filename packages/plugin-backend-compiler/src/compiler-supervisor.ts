import {
	type CompilerJobFailure,
	CompilerWorkerUnavailable,
	makeCompilerWorkerPool,
} from "@ryot-app/compiler-worker/pool";
import { SandboxScriptManifest } from "@ryot-app/contract/modules/scripts/schemas";
import { sanitizeEnvironment } from "@ryot-app/vite-compiler/environment";
import { Effect, Match, Schema } from "effect";

import {
	pluginBackendCompilerDiagnostic,
	PluginBackendCompilerFailure,
	sandboxCompilationFailure,
} from "./compiler-diagnostics";
import { CompilerWorkerRequest, CompilerWorkerResponse } from "./compiler-protocol";
import { SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

const failure = (code: string, message: string) =>
	sandboxCompilationFailure([pluginBackendCompilerDiagnostic(code, message)]);

const jobFailure = Match.type<CompilerJobFailure>().pipe(
	Match.when("Timeout", () =>
		failure(
			"RYOT_COMPILER_TIMEOUT",
			`Sandbox compilation timed out after ${SANDBOX_COMPILER_LIMITS.timeoutMs}ms`,
		),
	),
	Match.when("MemoryExceeded", () =>
		failure(
			"RYOT_COMPILER_MEMORY",
			`Sandbox compiler exceeded ${SANDBOX_COMPILER_LIMITS.memoryBytes} bytes of proportional memory`,
		),
	),
	Match.when("OutputExceeded", () =>
		failure("RYOT_COMPILER_PROCESS", "Sandbox compiler returned an oversized result"),
	),
	Match.exhaustive,
);

const encodeRequest = Schema.encodeEffect(Schema.fromJsonString(CompilerWorkerRequest));
const decodeResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(CompilerWorkerResponse));
const decodeManifest = Schema.decodeUnknownEffect(SandboxScriptManifest);

const invalidResult = new CompilerWorkerUnavailable({
	message: "The sandbox compiler worker returned an invalid result",
});

export type SandboxCompilerSupervisorOptions = {
	readonly workerPath: string;
	readonly verifyEnvironment?: boolean;
	readonly workspaceDirectory?: string;
};

export const makeSandboxCompilerSupervisor = Effect.fnUntraced(function* (
	options: SandboxCompilerSupervisorOptions,
) {
	const env = yield* Effect.fromResult(sanitizeEnvironment({ includePath: true })).pipe(
		Effect.orDie,
	);
	const pool = yield* makeCompilerWorkerPool({
		env,
		jobFailure,
		path: options.workerPath,
		label: "sandbox-compiler",
		size: SANDBOX_COMPILER_LIMITS.concurrency,
		timeoutMs: SANDBOX_COMPILER_LIMITS.timeoutMs,
		memoryBytes: SANDBOX_COMPILER_LIMITS.memoryBytes,
		outputBytes: SANDBOX_COMPILER_LIMITS.responseBytes,
		idleTimeoutMs: SANDBOX_COMPILER_LIMITS.idleTimeoutMs,
		startupTimeoutMs: SANDBOX_COMPILER_LIMITS.startupTimeoutMs,
		recycleMemoryBytes: SANDBOX_COMPILER_LIMITS.recycleMemoryBytes,
		goMemoryLimitBytes: SANDBOX_COMPILER_LIMITS.goMemoryLimitBytes,
		memoryPollIntervalMs: SANDBOX_COMPILER_LIMITS.memoryPollIntervalMs,
		...(options.verifyEnvironment === undefined
			? {}
			: { verifyEnvironment: options.verifyEnvironment }),
		...(options.workspaceDirectory === undefined
			? {}
			: { workspaceDirectory: options.workspaceDirectory }),
	});

	const compile = (source: string) =>
		Effect.gen(function* () {
			if (utf8ByteLength(source) > SANDBOX_COMPILER_LIMITS.sourceBytes) {
				return yield* failure(
					"RYOT_SOURCE_SIZE",
					`Sandbox TypeScript source exceeds ${SANDBOX_COMPILER_LIMITS.sourceBytes} UTF-8 bytes`,
				);
			}
			const output = yield* pool.run((job) =>
				encodeRequest({
					source,
					workspaceJobId: job.jobId,
					workspaceParentPath: job.parentPath,
				}).pipe(Effect.orDie),
			);
			const response = yield* decodeResponse(output).pipe(Effect.mapError(() => invalidResult));
			if (!response.success) {
				return yield* new PluginBackendCompilerFailure(response.error);
			}
			const manifest = yield* decodeManifest(response.value.manifest).pipe(
				Effect.mapError(() => invalidResult),
			);
			return { manifest, format: response.value.format, javascript: response.value.javascript };
		});

	return { compile };
});
