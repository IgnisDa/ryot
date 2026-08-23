import { BunServices } from "@effect/platform-bun";
import { SandboxCompilationFailure } from "@ryot-app/contract/modules/sandbox/schemas";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { CompilerWorkerRequest, CompilerWorkerResponse } from "@ryot-app/sandbox-compiler/protocol";
import { sandboxManifestSchema } from "@ryot-app/sandbox-sdk/core";
import { getCompilerWorkspaceRoot } from "@ryot-app/vite-compiler";
import { Context, Effect, FileSystem, Layer, Match, Path, Schema, Semaphore } from "effect";

import {
	type CompilerWorkerFailure,
	makeCompilerWorkerRunner,
} from "#lib/infrastructure/compiler-worker/runner";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";

const processFailure = (code: string, message: string) =>
	new SandboxCompilationFailure({
		message: "Sandbox TypeScript compilation failed",
		diagnostics: [{ code, message, line: 1, column: 1, severity: "error", file: "script.ts" }],
	});

const workerFailure = Match.type<CompilerWorkerFailure>().pipe(
	Match.tag("Timeout", () =>
		processFailure(
			"RYOT_COMPILER_TIMEOUT",
			`Sandbox compilation timed out after ${SANDBOX_LIMITS.compiler.timeoutMs}ms`,
		),
	),
	Match.tag("MemoryExceeded", () =>
		processFailure(
			"RYOT_COMPILER_MEMORY",
			`Sandbox compiler exceeded ${SANDBOX_LIMITS.compiler.memoryBytes} bytes of proportional memory`,
		),
	),
	Match.tag("MemorySupervisionFailed", () =>
		processFailure(
			"RYOT_COMPILER_MEMORY",
			"Sandbox compiler memory supervision became unavailable",
		),
	),
	Match.tag("OutputExceeded", () =>
		processFailure("RYOT_COMPILER_PROCESS", "Sandbox compiler returned an oversized result"),
	),
	Match.tag("ProcessExited", () =>
		processFailure(
			"RYOT_COMPILER_PROCESS",
			"Sandbox compiler process exited before returning a result",
		),
	),
	Match.tag("ProcessUnavailable", () =>
		processFailure(
			"RYOT_COMPILER_PROCESS",
			"Sandbox compiler process could not be started or read",
		),
	),
	Match.exhaustive,
);

const decodeCompilerWorkerResponse = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CompilerWorkerResponse),
);
const encodeCompilerWorkerRequest = Schema.encodeSync(Schema.fromJsonString(CompilerWorkerRequest));

export const makeSandboxCompiler = (configuredWorkspaceParentPath?: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const workspaceParentPath =
			configuredWorkspaceParentPath ??
			(yield* fs.makeTempDirectoryScoped({ prefix: "ryot-sandbox-compiler-" }));
		const semaphore = yield* Semaphore.make(SANDBOX_LIMITS.compiler.concurrency);
		const current = new URL(import.meta.url);
		const currentPath = yield* path.fromFileUrl(current).pipe(Effect.orDie);
		const workerPath = currentPath.endsWith(".ts")
			? Bun.resolveSync("@ryot-app/sandbox-compiler/worker", currentPath)
			: yield* path
					.fromFileUrl(new URL("./sandbox-compiler-worker.js", current))
					.pipe(Effect.orDie);
		const runWorker = yield* makeCompilerWorkerRunner({
			semaphore,
			path: workerPath,
			failure: workerFailure,
			timeoutMs: SANDBOX_LIMITS.compiler.timeoutMs,
			memoryBytes: SANDBOX_LIMITS.compiler.memoryBytes,
			memoryPollIntervalMs: SANDBOX_LIMITS.compiler.memoryPollIntervalMs,
		});

		const compile = (source: string) => {
			if (utf8ByteLength(source) > SANDBOX_LIMITS.compiler.sourceBytes) {
				return Effect.fail(
					processFailure(
						"RYOT_SOURCE_SIZE",
						`Sandbox TypeScript source exceeds ${SANDBOX_LIMITS.compiler.sourceBytes} UTF-8 bytes`,
					),
				);
			}

			const workspaceJobId = crypto.randomUUID();
			const workspaceRoot = Effect.fromResult(
				getCompilerWorkspaceRoot({ jobId: workspaceJobId, parentPath: workspaceParentPath }),
			).pipe(Effect.orDie);
			return Effect.acquireUseRelease(
				workspaceRoot,
				() =>
					runWorker(
						encodeCompilerWorkerRequest({ source, workspaceJobId, workspaceParentPath }),
					).pipe(
						Effect.flatMap((output) =>
							decodeCompilerWorkerResponse(output).pipe(
								Effect.mapError(() =>
									processFailure(
										"RYOT_COMPILER_PROCESS",
										"Sandbox compiler process returned an invalid result",
									),
								),
							),
						),
						Effect.flatMap((response) => {
							if (!response.success) {
								return Effect.fail(
									new SandboxCompilationFailure({
										message: response.error.message,
										diagnostics: response.error.diagnostics,
									}),
								);
							}

							return Schema.decodeUnknownEffect(sandboxManifestSchema)(
								response.value.manifest,
							).pipe(
								Effect.mapError(() =>
									processFailure(
										"RYOT_COMPILER_PROCESS",
										"Sandbox compiler process returned an invalid manifest",
									),
								),
								Effect.map((manifest) => ({
									manifest,
									format: response.value.format,
									javascript: response.value.javascript,
								})),
							);
						}),
					),
				(root) => fs.remove(root, { force: true, recursive: true }).pipe(Effect.orDie),
			);
		};

		return { compile };
	});

export class SandboxCompiler extends Context.Service<SandboxCompiler>()("SandboxCompiler", {
	make: makeSandboxCompiler().pipe(Effect.orDie),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(BunServices.layer));
}
