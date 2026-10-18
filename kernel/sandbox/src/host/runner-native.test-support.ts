import { BunServices } from "@effect/platform-bun";
import { assert } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { pluginBackendCompilerPlatformLayer } from "@ryot-app/plugin-backend-compiler/platform";
import type { WorkflowReplayJournalEntry } from "@ryot-app/plugin-backend-sdk/workflow";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect, Layer, Result, Schema } from "effect";

import { SANDBOX_LIMITS } from "../protocol/limits";
import {
	SandboxInvocationResponseSchema,
	SandboxInvocationSchema,
	type SidecarHostCallFrame,
	type SidecarHostResultFrame,
	type SidecarInboundLogicalMessage,
} from "../protocol/messages";
import { SandboxSidecarAdmission } from "./admission";
import { SandboxSidecarClient } from "./client";
import type { compileTestScript } from "./compile.test-support";
import { makeUserPluginRevision } from "./executor.test-support";
import { encodeJson } from "./host-call-args.test-support";
import { SandboxHostCallGate } from "./host-call-gate";
import { makeSandboxHostConfigLayer } from "./host.test-support";
import type { BoundHostFunction, SandboxRunInput } from "./invocation";
import { memoryPinnedJournal } from "./pinned-journal.test-support";
import { makeUserPrincipal, makeUserSubject } from "./run-input.test-support";
import { selectSnapshotTier } from "./snapshot-tier";

export type RunnerCompiled = Effect.Success<ReturnType<typeof compileTestScript>>;
export type SidecarRecorder = {
	readonly retired?: (handle: string) => void;
	readonly connected?: (settings: SidecarSettings, connection: SidecarConnection) => void;
	readonly received?: (
		frame: Effect.Success<SidecarConnection["next"]>,
		settings: SidecarSettings,
	) => void;
	readonly sent?: (
		frame: SidecarInboundLogicalMessage,
		settings: SidecarSettings,
	) => SidecarInboundLogicalMessage;
};

export type RunnerOptions = Partial<
	Pick<SandboxRunInput, "lane" | "executionId" | "inlineDurableHost" | "workflowExecutionId">
> & {
	readonly filesystem?: { readonly artifact: boolean };
	readonly functions?: Readonly<Record<string, BoundHostFunction>>;
	readonly replayJournal?: ReadonlyArray<WorkflowReplayJournalEntry>;
	readonly reply?: (
		frame: typeof SidecarHostCallFrame.Type,
	) => undefined | (typeof SidecarHostResultFrame.Type)["result"];
};
type SidecarSettings = Parameters<SandboxSidecarClient["Service"]["connect"]>[0];
type SidecarConnection = Effect.Success<ReturnType<SandboxSidecarClient["Service"]["connect"]>>;

const definitionEntryPoint = (kind: string | undefined) => {
	if (kind === "operation") {
		return "defineOperation";
	}
	if (kind === "workflow") {
		return "defineWorkflow";
	}
	if (kind === "automation") {
		return "defineAutomation";
	}
	return "defineScript";
};

export const defineNativeScript = (
	run: string,
	options: {
		readonly name?: string;
		readonly slug?: string;
		readonly input?: string;
		readonly output?: string;
		readonly imports?: string;
		readonly topLevel?: string;
		readonly kind?: "script" | "workflow" | "provider" | "operation" | "automation";
	} = {},
) => `
${options.kind === "workflow" ? 'import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/workflow";' : 'import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";'}
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
${options.kind === "operation" ? 'import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";' : ""}
${options.kind === "workflow" ? 'import { defineWorkflow } from "@ryot-app/plugin-backend-sdk/workflow";' : ""}
${options.kind === "automation" ? 'import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";' : ""}
${options.imports ?? ""}
export const manifest = defineManifest({
  kind: "${options.kind ?? "script"}", name: "${options.name ?? "Native runner"}", slug: "${options.slug ?? "native-runner"}",
  ${options.kind === "automation" ? 'automationType: "automation", inputProjection: { signal: { properties: ["message"] } },' : ""}
});
${options.topLevel ?? ""}
export default ${definitionEntryPoint(options.kind)}({
  manifest,
  ${options.kind === "automation" ? "" : `input: ${options.input ?? "Schema.Struct({})"}, output: ${options.output ?? "Schema.Unknown"},`}
  run: ${run},
});
`;

export const nativePlatformLayer = Layer.mergeAll(
	BunServices.layer,
	pluginBackendCompilerPlatformLayer,
);

export const recordingSidecarClient = <R>(makeRecorder: Effect.Effect<SidecarRecorder, never, R>) =>
	Layer.effect(
		SandboxSidecarClient,
		Effect.gen(function* () {
			const real = yield* SandboxSidecarClient;
			const recorder = yield* makeRecorder;
			return {
				connect: Effect.fnUntraced(function* (settings: SidecarSettings) {
					const connection = yield* real.connect(settings);
					recorder.connected?.(settings, connection);
					return {
						...connection,
						next: connection.next.pipe(
							Effect.tap((frame) => Effect.sync(() => recorder.received?.(frame, settings))),
						),
						send: (frame: SidecarInboundLogicalMessage, released?: () => void) =>
							connection.send(recorder.sent?.(frame, settings) ?? frame, released),
						retire: (handle: string) =>
							connection
								.retire(handle)
								.pipe(Effect.tap(() => Effect.sync(() => recorder.retired?.(handle)))),
					};
				}),
			};
		}),
	).pipe(Layer.provide(SandboxSidecarClient.layer));

export const runnerNativeLayer = Layer.mergeAll(
	SandboxSidecarClient.layer,
	SandboxHostCallGate.layer.pipe(Layer.provideMerge(SandboxSidecarAdmission.layer)),
).pipe(Layer.provideMerge(makeSandboxHostConfigLayer()), Layer.provideMerge(nativePlatformLayer));

export const makeRunnerInput = (
	compiled: RunnerCompiled,
	context: unknown,
	options: RunnerOptions = {},
): SandboxRunInput => {
	const userId = UserId.make("native-runner-owner");
	const contentHash = sha256Hex(compiled.javascript);
	return {
		context,
		compiledFormat: compiled.format,
		compiledCode: compiled.javascript,
		lane: options.lane ?? "interactive",
		startedAt: "2026-08-06T00:00:00.000Z",
		executionId: options.executionId ?? "native-runner-execution",
		principal: makeUserPrincipal({
			contentHash,
			metadata: compiled.manifest,
			subject: makeUserSubject(userId),
			scriptId: SandboxScriptId.make("native-runner-script"),
			pluginRevision: makeUserPluginRevision({
				ownerId: userId,
				compiledHashes: { [compiled.manifest.slug]: contentHash },
			}),
		}),
		...(options.workflowExecutionId === undefined
			? {}
			: { workflowExecutionId: options.workflowExecutionId }),
		...(options.workflowExecutionId === undefined && options.replayJournal === undefined
			? {}
			: { replayJournal: memoryPinnedJournal(options.replayJournal ?? []) }),
		...(options.inlineDurableHost === undefined
			? {}
			: { inlineDurableHost: options.inlineDurableHost }),
	};
};

export const runNativeOutcome = Effect.fnUntraced(function* (
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
				memoryBudget: 388 * 1024 * 1024,
			});
			const ready = yield* connection.next;
			assert(ready.type === "ready");
			const filesystem = {
				scratch: false,
				namedArtifacts: [],
				artifact: options.filesystem?.artifact ?? false,
			};
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
			yield* connection.register(handle, input.lane);
			yield* Effect.addFinalizer(() => connection.close.pipe(Effect.orDie));
			const invocation = yield* Schema.decodeUnknownEffect(SandboxInvocationSchema)({
				context,
				filesystem,
				mode: "definition",
				startedAt: input.startedAt,
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
				lane: input.lane,
				module: { source: compiled.javascript, sha256: input.principal.contentHash },
				limits: { ...SANDBOX_LIMITS.isolate, deadlineMs: SANDBOX_LIMITS.execution.timeoutMs },
			});
			const controls: string[] = [];
			for (;;) {
				const event = yield* connection.next;
				if (event.type === "hostCall") {
					controls.push(event.name);
					const result = options.reply?.(event);
					yield* connection.send(
						result === undefined
							? yield* registration.dispatch(event)
							: {
									result,
									seq: event.seq,
									type: "hostResult",
									handle: event.handle,
									generation: event.generation,
								},
					);
					continue;
				}
				assert(event.type === "done", encodeJson(event));
				return {
					controls,
					outcome: event.outcome,
					inline: registration.inlineEntries(),
					pendingInline: registration.pendingEntries(),
				};
			}
		}).pipe(Effect.withSpan("sandbox.native-runner-test")),
	);
});

export const runNative = Effect.fnUntraced(function* (
	compiled: RunnerCompiled,
	context: unknown,
	options: RunnerOptions = {},
) {
	const { outcome, ...run } = yield* runNativeOutcome(compiled, context, options);
	assert(outcome.status === "completed", encodeJson(outcome));
	const response = yield* Schema.decodeUnknownEffect(SandboxInvocationResponseSchema)(
		outcome.value,
	);
	return { ...run, response };
});
