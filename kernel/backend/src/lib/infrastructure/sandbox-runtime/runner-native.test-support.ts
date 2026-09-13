import { BunServices } from "@effect/platform-bun";
import { assert } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { sandboxCompilerPlatformLayer } from "@ryot-app/sandbox-compiler/platform";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect, Layer, Result, Schema } from "effect";

import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { sandboxRuntimeDirectory } from "#lib/test-utils/sandbox-runtime";
import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { SandboxHostCallGate } from "./host-call-gate";
import { SANDBOX_RUNNER_LIMITS } from "./limits";
import type { BoundHostFunction, SandboxRunInput } from "./shared";
import { SandboxSidecarClient } from "./sidecar-client";
import { SandboxInvocationResponseSchema, SandboxInvocationSchema } from "./sidecar-protocol";
import { selectSnapshotTier } from "./snapshot-tier";

export type RunnerCompiled = Effect.Success<ReturnType<SandboxCompiler["Service"]["compile"]>>;
export type RunnerOptions = Partial<
	Pick<
		SandboxRunInput,
		"executionId" | "workflowExecutionId" | "replayJournal" | "inlineDurableHost"
	>
> & { readonly functions?: Readonly<Record<string, BoundHostFunction>> };

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const runnerNativeLayer = Layer.unwrap(
	Effect.map(sandboxRuntimeDirectory, (runtimeDirectory) =>
		Layer.mergeAll(
			SandboxSidecarClient.layer,
			SandboxCompiler.layer,
			SandboxHostCallGate.layer,
		).pipe(Layer.provideMerge(makeAppConfigLayer({ sandbox: { runtimeDirectory } }))),
	),
).pipe(Layer.provideMerge(Layer.mergeAll(BunServices.layer, sandboxCompilerPlatformLayer)));

export const makeRunnerInput = (
	compiled: RunnerCompiled,
	context: unknown,
	options: RunnerOptions = {},
): SandboxRunInput => {
	const userId = UserId.make("native-runner-uploader");
	return {
		context,
		compiledFormat: compiled.format,
		compiledCode: compiled.javascript,
		startedAt: "2026-08-06T00:00:00.000Z",
		executionId: options.executionId ?? "native-runner-execution",
		principal: {
			providerId: null,
			pluginRevision: null,
			metadata: compiled.manifest,
			standaloneUploaderId: userId,
			scriptSlug: compiled.manifest.slug,
			contentHash: sha256Hex(compiled.javascript),
			scriptId: SandboxScriptId.make("native-runner-script"),
			subject: {
				userId,
				type: "user",
				accountGeneration: { userId, token: "native-runner-account" },
			},
		},
		...(options.workflowExecutionId === undefined
			? {}
			: { workflowExecutionId: options.workflowExecutionId }),
		...(options.workflowExecutionId === undefined && options.replayJournal === undefined
			? {}
			: { replayJournal: options.replayJournal ?? [] }),
		...(options.inlineDurableHost === undefined
			? {}
			: { inlineDurableHost: options.inlineDurableHost }),
	};
};

export const runNative = Effect.fnUntraced(function* (
	compiled: RunnerCompiled,
	context: unknown,
	options: RunnerOptions = {},
) {
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const client = yield* SandboxSidecarClient;
			const gate = yield* SandboxHostCallGate;
			const selected = selectSnapshotTier(compiled.manifest.runtimeImports);
			assert(Result.isSuccess(selected));
			const tier = selected.success;
			const generation = 1;
			const handle = sha256Hex(`${compiled.javascript}:${options.executionId ?? "runner"}`);
			const input = makeRunnerInput(compiled, context, options);
			const connection = yield* client.connect({
				tier,
				generation,
				threads: 1,
				maxActive: 1,
				trust: "user",
				maxRss: 450 * 1024 * 1024,
				memoryBudget: 324 * 1024 * 1024,
			});
			const ready = yield* connection.next;
			assert(ready.type === "ready");
			const filesystem = { scratch: false, artifact: false, namedArtifacts: [] };
			const registration = yield* gate.register({
				input,
				handle,
				generation,
				instance: `user/${tier}`,
				parentSpan: yield* Effect.currentSpan,
				apiFunctions: options.functions ?? {},
				files: {
					filesystem,
					harvest: () => Effect.succeed(null),
					scratchWrite: () => Effect.die("Unexpected runner scratch write"),
					artifactReadRange: () => Effect.die("Unexpected runner artifact read"),
				},
			});
			yield* connection.register(handle);
			yield* Effect.addFinalizer(() => connection.close.pipe(Effect.orDie));
			const invocation = yield* Schema.decodeUnknownEffect(SandboxInvocationSchema)({
				context,
				filesystem,
				mode: "definition",
				startedAt: input.startedAt,
				limits: SANDBOX_RUNNER_LIMITS,
				executionId: input.executionId,
				compiledFormat: compiled.format,
				metadata: input.principal.metadata,
				scriptId: input.principal.scriptId,
				apiFunctions: [...Object.keys(options.functions ?? {}), "replayJournal"],
				...(input.workflowExecutionId === undefined
					? {}
					: { workflowExecutionId: input.workflowExecutionId }),
				...(registration.journal === undefined ? {} : { journal: registration.journal }),
				inlineDurableCapabilities: input.inlineDurableHost?.capabilities ?? [],
			});
			const jsonInput = yield* Schema.decodeUnknownEffect(Schema.Json)(invocation);
			yield* connection.send({
				tier,
				handle,
				seq: 0,
				generation,
				type: "run",
				input: jsonInput,
				lane: "interactive",
				module: { source: compiled.javascript, sha256: input.principal.contentHash },
				limits: {
					cpuMs: 30_000,
					deadlineMs: 30_000,
					heapBytes: 256 * 1024 * 1024,
					externalBytes: 64 * 1024 * 1024,
				},
			});
			const controls: string[] = [];
			for (;;) {
				const event = yield* connection.next;
				if (event.type === "hostCall") {
					controls.push(event.name);
					yield* connection.send(yield* registration.dispatch(event));
					continue;
				}
				assert(event.type === "done", encodeJson(event));
				assert(event.outcome.status === "completed", encodeJson(event.outcome));
				const response = yield* Schema.decodeUnknownEffect(SandboxInvocationResponseSchema)(
					event.outcome.value,
				);
				return { response, controls, inline: registration.inlineEntries() };
			}
		}).pipe(Effect.withSpan("sandbox.native-runner-test")),
	);
});
