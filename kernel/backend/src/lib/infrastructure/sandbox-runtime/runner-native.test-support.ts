import { BunServices } from "@effect/platform-bun";
import { assert } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { sandboxCompilerPlatformLayer } from "@ryot-app/sandbox-compiler/platform";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect, Layer, Result, Schema } from "effect";

import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { makeUserPluginRevision, sandboxRuntimeDirectory } from "#lib/test-utils/sandbox-runtime";
import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { SandboxHostCallGate } from "./host-call-gate";
import type { SandboxHostImplementationMaps } from "./host-implementations";
import { SANDBOX_LIMITS } from "./limits";
import type { RuntimeSandboxHostImplementationMap } from "./runtime-host-functions";
import type { BoundHostFunction, SandboxRunInput } from "./shared";
import { SandboxSidecarClient } from "./sidecar-client";
import {
	SandboxInvocationResponseSchema,
	SandboxInvocationSchema,
	type SidecarHostCallFrame,
	type SidecarHostResultFrame,
	type SidecarInboundFrame,
} from "./sidecar-protocol";
import { selectSnapshotTier } from "./snapshot-tier";

export type RunnerCompiled = Effect.Success<ReturnType<SandboxCompiler["Service"]["compile"]>>;
export type RunnerOptions = Partial<
	Pick<
		SandboxRunInput,
		"executionId" | "workflowExecutionId" | "replayJournal" | "inlineDurableHost"
	>
> & {
	readonly functions?: Readonly<Record<string, BoundHostFunction>>;
	readonly filesystem?: { readonly artifact: boolean };
	readonly reply?: (
		frame: typeof SidecarHostCallFrame.Type,
	) => (typeof SidecarHostResultFrame.Type)["result"] | undefined;
};

type SidecarSettings = Parameters<SandboxSidecarClient["Service"]["connect"]>[0];
type SidecarConnection = Effect.Success<ReturnType<SandboxSidecarClient["Service"]["connect"]>>;
export type SidecarRecorder = {
	readonly connected?: (settings: SidecarSettings, connection: SidecarConnection) => void;
	readonly received?: (
		frame: Effect.Success<SidecarConnection["next"]>,
		settings: SidecarSettings,
	) => void;
	readonly sent?: (frame: SidecarInboundFrame, settings: SidecarSettings) => SidecarInboundFrame;
	readonly retired?: (handle: string) => void;
};

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const unusedHostCall = () => Effect.die("Unexpected native sandbox host dispatch");
const unusedLifecycleValue = (): never => {
	throw new Error("Unexpected native sandbox lifecycle value");
};
const unusedLifecycleSteps = {
	commit: unusedHostCall,
	prepare: unusedHostCall,
	validate: unusedHostCall,
	value: unusedLifecycleValue,
	applyPolicies: unusedHostCall,
};

export const nativePlatformLayer = Layer.mergeAll(BunServices.layer, sandboxCompilerPlatformLayer);

export const nativeConfigLayer = (overrides: Parameters<typeof makeAppConfigLayer>[0] = {}) =>
	Layer.unwrap(
		Effect.map(sandboxRuntimeDirectory, (runtimeDirectory) =>
			makeAppConfigLayer({ ...overrides, sandbox: { ...overrides.sandbox, runtimeDirectory } }),
		),
	);

export const unusedSandboxHostImplementations = (
	runtime: Partial<RuntimeSandboxHostImplementationMap> = {},
): SandboxHostImplementationMaps => ({
	automation: { emitSignal: unusedHostCall, sendNotification: unusedHostCall },
	runtime: {
		httpCall: unusedHostCall,
		setCachedValue: unusedHostCall,
		getCachedValue: unusedHostCall,
		getPersistentValue: unusedHostCall,
		claimPersistentValue: unusedHostCall,
		...runtime,
	},
	lifecycle: {
		upsertGlobalEntities: unusedLifecycleSteps,
		changeUserRelationships: unusedLifecycleSteps,
		upsertGlobalRelationships: unusedLifecycleSteps,
		updateEvents: { commit: unusedHostCall, validate: unusedHostCall },
		deleteEvents: { commit: unusedHostCall, validate: unusedHostCall },
	},
	additional: {
		deleteEvents: unusedHostCall,
		createEvents: unusedHostCall,
		updateEvents: unusedHostCall,
		executeRyotql: unusedHostCall,
		getPluginConfig: unusedHostCall,
		getUserSettings: unusedHostCall,
		listIntegrations: unusedHostCall,
		listEventSchemas: unusedHostCall,
		getEntitySchemas: unusedHostCall,
		getUserPreferences: unusedHostCall,
		ensureUserEntities: unusedHostCall,
		getOAuthAccessToken: unusedHostCall,
		upsertGlobalEntities: unusedHostCall,
		getCurrentIntegration: unusedHostCall,
		requestEventStreamWork: unusedHostCall,
		changeUserRelationships: unusedHostCall,
		upsertGlobalRelationships: unusedHostCall,
	},
});

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
						send: (frame: SidecarInboundFrame) =>
							connection.send(recorder.sent?.(frame, settings) ?? frame),
						next: connection.next.pipe(
							Effect.tap((frame) => Effect.sync(() => recorder.received?.(frame, settings))),
						),
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
	SandboxCompiler.layer,
	SandboxHostCallGate.layer,
).pipe(Layer.provideMerge(nativeConfigLayer()), Layer.provideMerge(nativePlatformLayer));

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
		startedAt: "2026-08-06T00:00:00.000Z",
		executionId: options.executionId ?? "native-runner-execution",
		principal: {
			contentHash,
			providerId: null,
			metadata: compiled.manifest,
			scriptSlug: compiled.manifest.slug,
			scriptId: SandboxScriptId.make("native-runner-script"),
			subject: {
				userId,
				type: "user",
				accountGeneration: { userId, token: "native-runner-account" },
			},
			pluginRevision: makeUserPluginRevision({
				ownerId: userId,
				slug: "native-runner-plugin",
				compiledHashes: { [compiled.manifest.slug]: contentHash },
			}),
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
			yield* connection.register(handle);
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
				lane: "interactive",
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
				assert(event.outcome.status === "completed", encodeJson(event.outcome));
				const response = yield* Schema.decodeUnknownEffect(SandboxInvocationResponseSchema)(
					event.outcome.value,
				);
				return { response, controls, inline: registration.inlineEntries() };
			}
		}).pipe(Effect.withSpan("sandbox.native-runner-test")),
	);
});
