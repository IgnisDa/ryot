import { BunServices } from "@effect/platform-bun";
import { expect, it, layer } from "@effect/vitest";
import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import {
	AutomationRunId,
	AutomationTriggerId,
	AutomationExecutionId,
	PluginId,
	PluginRevisionId,
	PluginConfigRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	workflowDurableResultSchema,
	workflowReplayJournalEntrySchema,
	workflowReplayEnvelopeSchema,
} from "@ryot-app/sandbox-sdk/workflow";
import type { Exit } from "effect";
import { Context, Deferred, Effect, Layer, Ref, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { RedisService } from "#lib/infrastructure/redis";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { makeWorkflowReplayJournalHostFunction } from "#lib/infrastructure/sandbox-runtime/workflow-journal";
import { makeActivity } from "#lib/infrastructure/workflow-scope";
import { assertExitFails } from "#lib/test-utils/assertions";
import {
	makeRedisService,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
	type WorkflowEngineOverrides,
} from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";

import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import { executeSandboxExecution, type SandboxExecutionQueuePayload } from "./durable-queues";
import {
	KernelWorkflowReferences,
	KERNEL_ENTITY_IMPORT_WORKFLOW,
} from "./kernel-workflow-references";
import { SandboxPluginScriptResolver } from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";
import {
	performSandboxWorkflowChild,
	performSandboxWorkflowRequest,
	runSandboxScriptWorkflowBody,
	SANDBOX_WORKFLOW_MAX_STEPS,
	SandboxScriptWorkflow,
	SandboxWorkflowPinning,
	sandboxWorkflowChildExecutionId,
	validateWorkflowReplayEnvelope,
} from "./sandbox-script-workflow";
import { SandboxScriptWorkflowPayload } from "./sandbox-script-workflow-payload";
import {
	SandboxWorkflowReferenceRegistrationError,
	SandboxWorkflowReferenceRepository,
} from "./workflow-reference-repository";

const pluginRevision = {
	ownerId: null,
	slug: "plugin",
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
	id: PluginId.make("plugin"),
	userBootstrapScriptSlugs: [],
	revisionId: PluginRevisionId.make("revision-1"),
	configRevisionId: PluginConfigRevisionId.make("config-1"),
	configSchema: { fields: {}, unknownKeys: "strict" as const },
	schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
};

const automationSubject = {
	stage: "after" as const,
	pluginId: pluginRevision.id,
	type: "automation-run" as const,
	runId: AutomationRunId.make("run-1"),
	executionUserId: UserId.make("user-1"),
	pluginRevisionId: pluginRevision.revisionId,
	triggerId: AutomationTriggerId.make("trigger-1"),
	pluginConfigRevisionId: pluginRevision.configRevisionId,
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
	causation: {
		depth: 0,
		parentRunId: null,
		parentTriggerId: null,
		source: "api" as const,
		initiator: { id: null, kind: "system" as const },
		executionId: AutomationExecutionId.make("execution-1"),
		rootExecutionId: AutomationExecutionId.make("execution-1"),
	},
};

class WorkflowTestCalls extends Context.Service<
	WorkflowTestCalls,
	{
		readonly record: (channel: string, value: unknown) => Effect.Effect<void>;
		readonly entries: (channel: string) => Effect.Effect<ReadonlyArray<unknown>>;
	}
>()("test/WorkflowTestCalls") {}

const workflowTestCallsLayer = Layer.effect(
	WorkflowTestCalls,
	Effect.gen(function* () {
		const channels = yield* Ref.make<ReadonlyMap<string, ReadonlyArray<unknown>>>(new Map());
		return {
			entries: (channel) => Ref.get(channels).pipe(Effect.map((all) => all.get(channel) ?? [])),
			record: (channel, value) =>
				Ref.update(channels, (all) =>
					new Map(all).set(channel, [...(all.get(channel) ?? []), value]),
				),
		};
	}),
);

const recordingLayer = <A, E, R, R2>(build: Effect.Effect<Layer.Layer<A, E, R>, never, R2>) =>
	Layer.unwrap(build).pipe(Layer.provideMerge(workflowTestCallsLayer));

const activityEngineLayer = (executionId: string, overrides?: WorkflowEngineOverrides) =>
	Layer.unwrap(
		Effect.sync(() => {
			const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
			return Layer.merge(
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowActivityEngine(instance, {
						deferredDone: () => Effect.void,
						deferredResult: () => Effect.succeedNone,
						...overrides,
					}),
				),
			);
		}),
	);

const withWorkflowPinning = <A, E, R>(dependencies: Layer.Layer<A, E, R>) =>
	SandboxWorkflowPinning.layer.pipe(Layer.provideMerge(dependencies));

const parentInstanceLayer = Layer.sync(WorkflowInstance, () =>
	WorkflowInstance.initial(SandboxScriptWorkflow, "parent"),
);

layer(
	withWorkflowPinning(
		recordingLayer(
			Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				return Layer.mergeAll(
					mutationAdmissionTestLayer,
					Layer.mock(SandboxPluginScriptResolver)({
						findActiveScriptById: () => Effect.die("Pinned runs must not resolve active scripts"),
					}),
					Layer.mock(SandboxRepository)({
						getScriptPin: (scriptId, expected) =>
							calls
								.record("pin-requests", { scriptId, expected })
								.pipe(
									Effect.as({
										scriptId,
										pluginRevision,
										providerId: null,
										scriptSlug: "script",
										contentHash: "hash-1",
										metadata: { kind: "automation" as const },
									}),
								),
					}),
					Layer.mock(SandboxWorkflowReferenceRepository)({
						lockIngestionShared: () => Effect.void,
						registerInTransaction: (input) =>
							calls
								.record("registrations", input)
								.pipe(Effect.as({ status: "registered" as const })),
					}),
				);
			}),
		),
	),
)((test) => {
	test.effect(
		"pins retained automation roots without active resolution and preserves serialized ownership",
		() => {
			const payload = Schema.decodeSync(Schema.fromJsonString(SandboxScriptWorkflowPayload))(
				JSON.stringify({
					input: {},
					pluginRevision,
					resolutionMode: "active",
					executionId: "execution-1",
					subject: automationSubject,
					scriptId: "historical-script",
				}),
			);
			return Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				const result = yield* (yield* SandboxWorkflowPinning).establish(payload, "execution-1");
				expect(yield* calls.entries("pin-requests")).toEqual([
					{
						scriptId: "historical-script",
						expected: { id: "plugin", revisionId: "revision-1", configRevisionId: "config-1" },
					},
				]);
				expect(result.principal).toMatchObject({ pluginRevision, subject: automationSubject });
				expect(yield* calls.entries("registrations")).toEqual([
					{
						userId: "user-1",
						pluginId: "plugin",
						allowInactive: true,
						contentHash: "hash-1",
						executionId: "execution-1",
						scriptId: "historical-script",
					},
				]);
				const pinning = yield* SandboxWorkflowPinning;
				const conflict = yield* Effect.exit(
					pinning.establish(
						{
							...payload,
							pluginRevision: {
								...pluginRevision,
								configRevisionId: PluginConfigRevisionId.make("other-config"),
							},
						},
						"execution-1",
					),
				);
				assertExitFails(
					conflict,
					new SandboxRunError({
						kind: "script-failure",
						message: "Sandbox workflow pin conflicts with automation ownership",
					}),
				);
			});
		},
	);
});

layer(
	withWorkflowPinning(
		recordingLayer(
			Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				return Layer.mergeAll(
					mutationAdmissionTestLayer,
					Layer.mock(SandboxPluginScriptResolver)({
						findActiveScriptById: () =>
							Effect.die("Source-zero runs must not resolve active scripts"),
					}),
					Layer.mock(SandboxRepository)({
						getScriptPin: (scriptId, expected) =>
							calls
								.record("pin-requests", { scriptId, expected })
								.pipe(
									Effect.as({
										scriptId,
										providerId: null,
										pluginRevision: null,
										contentHash: "kernel-v1",
										scriptSlug: "notification",
										metadata: { kind: "automation" as const },
									}),
								),
					}),
					Layer.mock(SandboxWorkflowReferenceRepository)({
						lockIngestionShared: () => Effect.void,
					}),
				);
			}),
		),
	),
)((test) => {
	test.effect("pins source-zero automation by exact script ID without a synthetic plugin", () => {
		const payload = {
			input: {},
			executionId: "kernel-run",
			resolutionMode: "active" as const,
			scriptId: SandboxScriptId.make("kernel-notification-v1"),
			subject: {
				...automationSubject,
				pluginId: null,
				pluginRevisionId: null,
				pluginConfigRevisionId: null,
			},
		};
		return Effect.gen(function* () {
			const result = yield* (yield* SandboxWorkflowPinning).establish(payload, "kernel-run");
			expect(yield* (yield* WorkflowTestCalls).entries("pin-requests")).toEqual([
				{ expected: undefined, scriptId: "kernel-notification-v1" },
			]);
			expect(result).toMatchObject({
				registrationStatus: "not-required",
				principal: {
					pluginRevision: null,
					subject: payload.subject,
					scriptId: "kernel-notification-v1",
				},
			});
		});
	});
});

const makeProjectionRedis = () =>
	makeRedisService({
		client: Object.assign(Object.create(null), {
			eval: () => Promise.resolve(1),
			hgetall: () => Promise.resolve({}),
		}),
	});

const controlledWorkflowDependencies = Layer.mergeAll(
	mutationAdmissionTestLayer,
	Layer.succeed(RedisService, makeProjectionRedis()),
	Layer.mock(SandboxArtifactStore)({ retain: () => Effect.void, release: () => Effect.void }),
	Layer.mock(SandboxPluginScriptResolver)({ findActiveScriptById: () => Effect.die("unused") }),
	Layer.mock(KernelWorkflowReferences)({ execute: () => Effect.die("unused") }),
	Layer.mock(SandboxDurableHostDispatcher)({ dispatch: () => Effect.die("unused") }),
);

it("sanitizes child id names deterministically", () => {
	expect(sandboxWorkflowChildExecutionId("parent", "events/import v1", 7)).toBe(
		"parent-child-events-import-v1-7",
	);
	expect(sandboxWorkflowChildExecutionId("parent", "events/import v1", 7)).toBe(
		sandboxWorkflowChildExecutionId("parent", "events/import v1", 7),
	);
});

it("keeps workflow replay bounded by the kernel", () => {
	expect(SANDBOX_WORKFLOW_MAX_STEPS).toBe(1_000);
});

const historicalScriptId = SandboxScriptId.make("historical-script-id");
const replacementScriptId = SandboxScriptId.make("replacement-script-id");
const hotSwapRequest = {
	index: 0,
	name: "kernel-step",
	kind: "child" as const,
	args: { input: { value: 1 }, workflowSlug: "kernel:test" },
};
const historicalContent = `
if [ "$JOURNAL" = "[]" ]; then
  printf '{"state":"pending","requests":[%s]}' "$REQUEST"
else
  printf '{"state":"completed","requests":[%s],"output":{"content":"pinned-v1","journal":%s}}' "$REQUEST" "$JOURNAL"
fi
`;
const replacementContent = `printf '{"state":"completed","requests":[],"output":{"content":"active-v2","journal":[]}}'`;
const hotSwapScript = (id: typeof historicalScriptId, compiledCode: string) => ({
	id,
	compiledCode,
	slug: "workflow",
	name: "Workflow",
	providerId: null,
	compiledFormat: 1,
	pluginSlug: "plugin",
	source: compiledCode,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	contentHash: id === historicalScriptId ? "historical-hash" : "replacement-hash",
	metadata: {
		name: "Workflow",
		slug: "workflow",
		capabilities: [],
		kind: "workflow" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
});
const historicalScript = hotSwapScript(historicalScriptId, historicalContent);
const replacementScript = hotSwapScript(replacementScriptId, replacementContent);
const hotSwapExecutionId = "workflow-execution";
const replayJournalResult = Schema.decodeUnknownEffect(
	Schema.Struct({
		success: Schema.Literal(true),
		data: Schema.Array(workflowReplayJournalEntrySchema),
	}),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeEnvelope = Schema.decodeUnknownEffect(
	Schema.fromJsonString(workflowReplayEnvelopeSchema),
);

class ActiveWorkflowScript extends Context.Service<
	ActiveWorkflowScript,
	{ readonly current: Effect.Effect<SandboxScriptId> }
>()("test/ActiveWorkflowScript") {}

const hotSwapLayer = recordingLayer(
	Effect.gen(function* () {
		const calls = yield* WorkflowTestCalls;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const active = yield* Ref.make(historicalScriptId);
		const hashes = new Map<string, Map<string, string>>();
		const redisClient: RedisService["Service"]["client"] = Object.assign(Object.create(null), {
			hgetall: (key: string) => Promise.resolve(Object.fromEntries(hashes.get(key) ?? [])),
			eval: (
				_script: string,
				_numberOfKeys: number,
				key: string,
				highWater: string,
				_ttl: string,
				...entries: string[]
			) => {
				const fields = hashes.get(key) ?? new Map<string, string>();
				fields.set("high-water", highWater);
				entries.forEach((entry, index) => fields.set(String(index), entry));
				hashes.set(key, fields);
				return Promise.resolve(1);
			},
		});
		const pinOf = (scriptId: SandboxScriptId) =>
			scriptId === historicalScriptId
				? {
						pluginRevision,
						providerId: null,
						scriptSlug: "workflow",
						scriptId: historicalScriptId,
						contentHash: "historical-hash",
						metadata: { capabilities: [], kind: "workflow" as const },
					}
				: {
						pluginRevision,
						providerId: null,
						scriptSlug: "workflow",
						scriptId: replacementScriptId,
						contentHash: "replacement-hash",
						metadata: { capabilities: [], kind: "workflow" as const },
					};
		return Layer.mergeAll(
			mutationAdmissionTestLayer,
			activityEngineLayer(hotSwapExecutionId),
			Layer.succeed(RedisService, makeRedisService({ client: redisClient })),
			Layer.mock(SandboxArtifactStore)({ retain: () => Effect.void, release: () => Effect.void }),
			Layer.mock(SandboxRepository)({
				resolveWorkflowCallScript: () => Effect.succeed(null),
				isPluginScript: () => calls.record("pin-events", "resolve-owned").pipe(Effect.as(true)),
				getScriptPin: (scriptId) =>
					calls.record("pin-events", "pin").pipe(Effect.as(pinOf(scriptId))),
				getScript: (scriptId) =>
					Effect.succeed(scriptId === historicalScriptId ? historicalScript : replacementScript),
			}),
			Layer.mock(SandboxPluginScriptResolver)({
				findActiveScriptById: () =>
					calls.record("pin-events", "resolve-active").pipe(
						Effect.andThen(Ref.get(active)),
						Effect.map((id) => (id === historicalScriptId ? historicalScript : replacementScript)),
					),
			}),
			Layer.mock(SandboxWorkflowReferenceRepository)({
				lockIngestionShared: () => calls.record("pin-events", "lock"),
				release: (registeredExecutionId) => calls.record("releases", registeredExecutionId),
				registerInTransaction: (input) =>
					calls
						.record("pin-events", "register")
						.pipe(
							Effect.andThen(calls.record("registrations", input)),
							Effect.as({ status: "registered" as const }),
						),
			}),
			Layer.mock(RuntimeSandboxService)({
				run: (input) =>
					Effect.gen(function* () {
						yield* calls.record("executed-content", input.compiledCode);
						const replayJournal = makeWorkflowReplayJournalHostFunction(input.workflowExecutionId, {
							client: redisClient,
						});
						const journal = yield* replayJournal([]).pipe(Effect.flatMap(replayJournalResult));
						const output = yield* Effect.gen(function* () {
							const process = yield* spawner.spawn(
								ChildProcess.make("/bin/sh", ["-c", input.compiledCode], {
									env: {
										REQUEST: encodeJson(hotSwapRequest),
										JOURNAL: encodeJson(journal.data.map(({ value }) => value)),
									},
								}),
							);
							return yield* process.stdout.pipe(
								Stream.decodeText(),
								Stream.runFold(
									() => "",
									(content, chunk) => content + chunk,
								),
							);
						}).pipe(Effect.scoped);
						yield* Ref.set(active, replacementScriptId);
						return {
							logs: [],
							inline: [],
							error: null,
							success: true,
							harvest: null,
							executionId: input.executionId,
							value: yield* decodeEnvelope(output),
							timing: { totalMs: 1, executionMs: 1 },
						};
					}).pipe(Effect.orDie),
			}),
			Layer.mock(KernelWorkflowReferences)({
				execute: (
					_workflowSlug,
					_input,
					_subject,
					_executionId,
					_parentExecutionId,
					callerScriptId,
				) => calls.record("kernel-callers", callerScriptId).pipe(Effect.as({ kernel: "recorded" })),
			}),
			Layer.mock(SandboxDurableHostDispatcher)({ dispatch: () => Effect.die("unused") }),
			Layer.succeed(ActiveWorkflowScript, { current: Ref.get(active) }),
		);
	}),
).pipe(Layer.provide(BunServices.layer));

layer(withWorkflowPinning(hotSwapLayer))((test) => {
	test.effect("keeps every shell replay on the initial script pin after an active hot swap", () => {
		const executionId = hotSwapExecutionId;
		const payload = {
			input: {},
			executionId,
			scriptId: historicalScriptId,
			resultMode: "execution" as const,
			resolutionMode: "active" as const,
			subject: { type: "system" as const },
		};

		return Effect.gen(function* () {
			const calls = yield* WorkflowTestCalls;
			const result = yield* runSandboxScriptWorkflowBody(payload, executionId, (executionPayload) =>
				executeSandboxExecution(executionPayload).pipe(
					Effect.mapError(
						(error) =>
							new SandboxRunError({ kind: "script-failure", message: unknownToMessage(error) }),
					),
				),
			);
			const executedContent = yield* calls.entries("executed-content");
			expect(result).toEqual({
				logs: [],
				error: null,
				status: "completed",
				timing: { totalMs: 1, executionMs: 1 },
				value: { content: "pinned-v1", journal: [{ kernel: "recorded" }] },
			});
			expect(yield* (yield* ActiveWorkflowScript).current).toBe(replacementScriptId);
			expect((yield* calls.entries("kernel-callers")).at(-1)).toBe(historicalScriptId);
			expect(executedContent).toEqual([historicalContent, historicalContent]);
			expect(executedContent).not.toContain(replacementContent);
			expect((yield* calls.entries("pin-events")).slice(0, 5)).toEqual([
				"lock",
				"resolve-owned",
				"resolve-active",
				"pin",
				"register",
			]);
			expect(yield* calls.entries("registrations")).toEqual([
				{
					executionId,
					pluginId: "plugin",
					scriptId: historicalScriptId,
					contentHash: "historical-hash",
				},
			]);
			expect(yield* calls.entries("releases")).toEqual([executionId]);
		});
	});
});

const pluginWorkflowPin = (scriptId: SandboxScriptId) => ({
	scriptId,
	pluginRevision,
	providerId: null,
	scriptSlug: "workflow",
	contentHash: "content-hash",
	metadata: { capabilities: [], kind: "workflow" as const },
});

const suspendedScriptId = SandboxScriptId.make("workflow-script");

layer(
	withWorkflowPinning(
		recordingLayer(
			Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				return Layer.mergeAll(
					mutationAdmissionTestLayer,
					controlledWorkflowDependencies,
					activityEngineLayer("suspended-workflow", {
						activityExecute: (activity) =>
							activity.name === "observe-sandbox-workflow-replay-0"
								? Effect.succeed(new Workflow.Suspended())
								: Effect.map(
										Effect.exit(activity.execute),
										(exit) => new Workflow.Complete({ exit }),
									),
					}),
					Layer.mock(SandboxRepository)({
						getScriptPin: () => Effect.succeed(pluginWorkflowPin(suspendedScriptId)),
					}),
					Layer.mock(SandboxWorkflowReferenceRepository)({
						lockIngestionShared: () => Effect.void,
						release: () => calls.record("releases", null),
						registerInTransaction: () =>
							calls
								.record("registrations", null)
								.pipe(Effect.as({ status: "registered" as const })),
					}),
				);
			}),
		),
	),
)((test) => {
	test.effect("retains a plugin workflow reference while durably suspended", () => {
		const executionId = "suspended-workflow";
		const scriptId = suspendedScriptId;

		return Effect.gen(function* () {
			const calls = yield* WorkflowTestCalls;
			const result = yield* Workflow.intoResult(
				runSandboxScriptWorkflowBody(
					{
						scriptId,
						input: {},
						executionId,
						resolutionMode: "exact",
						subject: { type: "system" },
					},
					executionId,
					() =>
						Effect.succeed({
							logs: [],
							inline: [],
							error: null,
							harvest: null,
							status: "completed" as const,
							value: {
								state: "pending" as const,
								requests: [
									{
										index: 0,
										kind: "host" as const,
										name: "getCachedValue",
										args: { args: ["key"], capability: "getCachedValue" as const },
									},
								],
							},
						}),
				),
			);
			expect(result._tag).toBe("Suspended");
			expect(yield* calls.entries("registrations")).toHaveLength(1);
			expect(yield* calls.entries("releases")).toHaveLength(0);
		});
	});
});

class RestartingEngine extends Context.Service<
	RestartingEngine,
	{ readonly engineFor: (instance: WorkflowInstance["Service"]) => WorkflowEngine["Service"] }
>()("test/RestartingEngine") {}

const interruptedScriptId = SandboxScriptId.make("operation-script");

layer(
	withWorkflowPinning(
		recordingLayer(
			Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				const activityExits = yield* Ref.make<ReadonlyMap<string, Exit.Exit<unknown, unknown>>>(
					new Map(),
				);
				const suspendAfterWrite = yield* Ref.make(true);
				return Layer.mergeAll(
					mutationAdmissionTestLayer,
					Layer.succeed(RedisService, makeProjectionRedis()),
					Layer.mock(SandboxArtifactStore)({
						retain: () => calls.record("artifact-retains", null),
						release: () => calls.record("artifact-releases", null),
					}),
					Layer.mock(SandboxPluginScriptResolver)({
						findActiveScriptById: () => Effect.die("unused"),
					}),
					Layer.mock(KernelWorkflowReferences)({ execute: () => Effect.die("unused") }),
					Layer.mock(SandboxRepository)({
						resolveWorkflowCallScript: () => Effect.succeed(null),
						getScriptPin: () =>
							Effect.succeed({
								providerId: null,
								pluginRevision: null,
								scriptSlug: "workflow",
								scriptId: interruptedScriptId,
								contentHash: "operation-hash",
								metadata: { kind: "workflow", capabilities: [] },
							}),
					}),
					Layer.mock(SandboxWorkflowReferenceRepository)({
						release: () => Effect.die("unused"),
						lockIngestionShared: () => Effect.void,
						registerInTransaction: () => Effect.die("unused"),
					}),
					Layer.mock(SandboxDurableHostDispatcher)({
						dispatch: () =>
							makeActivity({
								error: SandboxRunError,
								success: workflowDurableResultSchema,
								name: "sandbox-host-0-setCachedValue",
								execute: calls
									.record("writes", null)
									.pipe(Effect.as({ value: null, state: "success" as const })),
							}),
					}),
					Layer.succeed(RestartingEngine, {
						engineFor: (instance) =>
							makeWorkflowActivityEngine(instance, {
								deferredDone: () => Effect.void,
								deferredResult: () => Effect.succeedNone,
								activityExecute: (activity) =>
									Effect.gen(function* () {
										if (
											activity.name === "observe-sandbox-workflow-replay-1" &&
											(yield* Ref.getAndSet(suspendAfterWrite, false))
										) {
											return new Workflow.Suspended();
										}
										const cached = (yield* Ref.get(activityExits)).get(activity.name);
										if (cached) {
											return new Workflow.Complete({ exit: cached });
										}
										const exit = yield* Effect.exit(activity.execute);
										yield* Ref.update(activityExits, (all) =>
											new Map(all).set(activity.name, exit),
										);
										return new Workflow.Complete({ exit });
									}),
							}),
					}),
				);
			}),
		),
	),
)((test) => {
	test.effect("reconstructs a completed host write after interruption without repeating it", () => {
		const executionId = "interrupted-host-write";
		const request = {
			index: 0,
			kind: "host" as const,
			name: "setCachedValue",
			args: {
				capability: "setCachedValue" as const,
				args: ["write-key", { value: 1 }, 60] as const,
			},
		};
		const payload = {
			input: {},
			executionId,
			scriptId: interruptedScriptId,
			resolutionMode: "exact" as const,
			subject: {
				type: "user" as const,
				userId: UserId.make("interrupted-user"),
				accountGeneration: {
					token: "test-account-generation",
					userId: UserId.make("interrupted-user"),
				},
			},
		};
		const processReplay = (sandboxPayload: SandboxExecutionQueuePayload) =>
			Effect.succeed({
				logs: [],
				inline: [],
				error: null,
				harvest: null,
				status: "completed" as const,
				value:
					sandboxPayload.executionId === `${executionId}-replay-0`
						? { requests: [request], state: "pending" as const }
						: { requests: [request], state: "completed" as const, output: { completed: true } },
			});

		return Effect.gen(function* () {
			const calls = yield* WorkflowTestCalls;
			const engines = yield* RestartingEngine;
			const onFreshInstance = <A, E, R>(workflow: Effect.Effect<A, E, R>) => {
				const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
				return workflow.pipe(
					Effect.provideService(WorkflowInstance, instance),
					Effect.provideService(WorkflowEngine, engines.engineFor(instance)),
				);
			};
			const first = yield* onFreshInstance(
				Workflow.intoResult(runSandboxScriptWorkflowBody(payload, executionId, processReplay)),
			);
			expect(first._tag).toBe("Suspended");
			expect(yield* calls.entries("writes")).toHaveLength(1);
			expect(yield* calls.entries("artifact-retains")).toHaveLength(1);
			expect(yield* calls.entries("artifact-releases")).toHaveLength(0);

			expect(
				yield* onFreshInstance(runSandboxScriptWorkflowBody(payload, executionId, processReplay)),
			).toEqual({ completed: true });
			expect(yield* calls.entries("writes")).toHaveLength(1);
			expect(yield* calls.entries("artifact-retains")).toHaveLength(1);
			expect(yield* calls.entries("artifact-releases")).toHaveLength(1);
		});
	});
});

layer(
	withWorkflowPinning(
		recordingLayer(
			Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				return Layer.mergeAll(
					mutationAdmissionTestLayer,
					controlledWorkflowDependencies,
					activityEngineLayer("failed-workflow"),
					Layer.mock(SandboxRepository)({
						getScriptPin: () =>
							Effect.succeed(pluginWorkflowPin(SandboxScriptId.make("workflow-script"))),
					}),
					Layer.mock(SandboxWorkflowReferenceRepository)({
						lockIngestionShared: () => Effect.void,
						release: () => calls.record("reference-events", "released"),
						registerInTransaction: () =>
							calls
								.record("reference-events", "registered")
								.pipe(Effect.as({ status: "registered" as const })),
					}),
				);
			}),
		),
	),
)((test) => {
	test.effect("releases a plugin workflow reference before returning terminal failure", () => {
		const executionId = "failed-workflow";
		const scriptId = SandboxScriptId.make("workflow-script");

		return Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runSandboxScriptWorkflowBody(
					{
						scriptId,
						input: {},
						executionId,
						resolutionMode: "exact",
						subject: { type: "system" },
					},
					executionId,
					() =>
						Effect.succeed({
							logs: [],
							inline: [],
							value: null,
							harvest: null,
							status: "completed" as const,
							error: {
								message: "boom",
								phase: "execute" as const,
								kind: "script-failure" as const,
							},
						}),
				),
			);
			assertExitFails(
				exit,
				new SandboxRunError({
					kind: "script-failure",
					message: "Workflow replay 0 failed: execute: boom",
				}),
			);
			expect(yield* (yield* WorkflowTestCalls).entries("reference-events")).toEqual([
				"registered",
				"released",
			]);
		});
	});
});

layer(
	withWorkflowPinning(
		Layer.mergeAll(
			mutationAdmissionTestLayer,
			controlledWorkflowDependencies,
			activityEngineLayer("inactive-plugin-workflow"),
			Layer.mock(SandboxRepository)({
				getScriptPin: () =>
					Effect.succeed(pluginWorkflowPin(SandboxScriptId.make("workflow-script"))),
			}),
			Layer.mock(SandboxWorkflowReferenceRepository)({
				lockIngestionShared: () => Effect.void,
				registerInTransaction: () =>
					Effect.fail(
						new SandboxWorkflowReferenceRegistrationError({
							reason: "plugin-inactive",
							message: "Plugin 'plugin' is not active",
						}),
					),
			}),
		),
	),
)((test) => {
	test.effect("maps inactive plugin pin registration to SandboxRunError", () => {
		const executionId = "inactive-plugin-workflow";
		const scriptId = SandboxScriptId.make("workflow-script");

		return Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runSandboxScriptWorkflowBody(
					{
						scriptId,
						input: {},
						executionId,
						resolutionMode: "exact",
						subject: { type: "system" },
					},
					executionId,
					() => Effect.die("unused"),
				),
			);
			assertExitFails(
				exit,
				new SandboxRunError({ kind: "missing-artifact", message: "Plugin 'plugin' is not active" }),
			);
		});
	});
});

it.effect("rejects divergence beyond index zero before a replay's generic script failure", () => {
	const first = {
		index: 0,
		name: "first",
		kind: "activity" as const,
		args: { input: { value: 1 }, scriptSlug: "activity" },
	};
	const recordedSecond = {
		index: 1,
		name: "original",
		kind: "sleep" as const,
		args: { durationMs: 10 },
	};
	const changedSecond = { ...recordedSecond, name: "changed" };

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			validateWorkflowReplayEnvelope(
				{
					state: "failed",
					kind: "script-failure",
					error: "generic script error",
					requests: [first, changedSecond],
				},
				[
					{ value: "one", request: first },
					{ value: null, request: recordedSecond },
				],
				[],
			),
		);
		expect(exit.toString()).toContain("journal[1]");
		expect(exit.toString()).not.toContain("generic script error");
	});
});

it.effect("registers every missing request after validating its full prefix", () => {
	const first = { index: 0, name: "first", kind: "sleep" as const, args: { durationMs: 10 } };
	const third = { index: 2, name: "third", kind: "sleep" as const, args: { durationMs: 30 } };
	const pending = { index: 1, name: "pending", kind: "sleep" as const, args: { durationMs: 20 } };
	return Effect.gen(function* () {
		expect(
			yield* validateWorkflowReplayEnvelope(
				{ state: "pending", requests: [first, pending, third] },
				[{ value: null, request: first }],
				[],
			),
		).toEqual({ state: "pending", requests: [{ request: pending }, { request: third }] });
	});
});

it.effect("retries after a replay bootstraps from a stale projection", () => {
	const first = { index: 0, name: "first", kind: "sleep" as const, args: { durationMs: 10 } };
	const second = { index: 1, name: "second", kind: "sleep" as const, args: { durationMs: 20 } };
	return Effect.gen(function* () {
		expect(
			yield* validateWorkflowReplayEnvelope(
				{ journalLength: 0, state: "pending", requests: [first] },
				[
					{ value: null, request: first },
					{ value: null, request: second },
				],
				[],
			),
		).toEqual({ state: "projection-stale" });
	});
});

it.effect("rejects a completed replay that only forges a stale length marker", () => {
	const first = { index: 0, name: "first", kind: "sleep" as const, args: { durationMs: 10 } };
	const second = { index: 1, name: "second", kind: "sleep" as const, args: { durationMs: 20 } };
	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			validateWorkflowReplayEnvelope(
				{ output: null, journalLength: 0, requests: [first], state: "completed" },
				[
					{ value: null, request: first },
					{ value: null, request: second },
				],
				[],
			),
		);
		expect(exit.toString()).toContain("replay ended before recorded journal[1]");
	});
});

const inlineCachedRequest = (index: number, capability: "getCachedValue" | "setCachedValue") => ({
	index,
	name: capability,
	kind: "host" as const,
	args: { capability, args: [`key-${index}`] },
});

it.effect("accepts inline entries only as the replay's continuation of its loaded journal", () => {
	const recorded = inlineCachedRequest(0, "getCachedValue");
	const inline = inlineCachedRequest(1, "getCachedValue");
	const pending = inlineCachedRequest(2, "setCachedValue");
	const journal = [{ request: recorded, value: { value: 0, state: "success" } }];
	const inlineEntries = [{ request: inline, value: { value: 1, state: "success" } }];
	return Effect.gen(function* () {
		expect(
			yield* validateWorkflowReplayEnvelope(
				{ journalLength: 1, state: "pending", requests: [recorded, inline, pending] },
				journal,
				inlineEntries,
			),
		).toEqual({ state: "pending", requests: [{ request: pending }] });
		expect(
			yield* validateWorkflowReplayEnvelope(
				{ output: null, journalLength: 1, state: "completed", requests: [recorded, inline] },
				journal,
				inlineEntries,
			),
		).toEqual({ output: null, state: "completed" });

		const detached = yield* Effect.exit(
			validateWorkflowReplayEnvelope(
				{ journalLength: 0, state: "pending", requests: [inline, pending] },
				journal,
				inlineEntries,
			),
		);
		expect(detached.toString()).toContain("do not extend the recorded journal");
		const diverged = yield* Effect.exit(
			validateWorkflowReplayEnvelope(
				{
					journalLength: 1,
					state: "pending",
					requests: [
						recorded,
						{ ...inline, args: { args: ["other"], capability: "getCachedValue" } },
					],
				},
				journal,
				inlineEntries,
			),
		);
		expect(diverged.toString()).toContain("SandboxWorkflowNondeterminism: journal[1]");
	});
});

const inlineScriptId = SandboxScriptId.make("inline-script");

layer(
	withWorkflowPinning(
		recordingLayer(
			Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				const services = yield* Effect.context();
				return Layer.mergeAll(
					mutationAdmissionTestLayer,
					Layer.mock(SandboxArtifactStore)({
						retain: () => Effect.void,
						release: () => Effect.void,
					}),
					Layer.mock(SandboxPluginScriptResolver)({
						findActiveScriptById: () => Effect.die("unused"),
					}),
					Layer.mock(KernelWorkflowReferences)({ execute: () => Effect.die("unused") }),
					Layer.succeed(
						RedisService,
						makeRedisService({
							client: Object.assign(Object.create(null), {
								hgetall: () => Promise.resolve({}),
								eval: (_script: string, _keys: number, _key: string, highWater: string) =>
									Effect.runPromiseWith(services)(
										calls.record("projected-high-waters", highWater).pipe(Effect.as(1)),
									),
							}),
						}),
					),
					Layer.mock(SandboxDurableHostDispatcher)({
						dispatch: (request) =>
							calls
								.record("dispatched", request.index)
								.pipe(Effect.as({ value: "written", state: "success" as const })),
					}),
					activityEngineLayer("inline-workflow"),
					Layer.mock(SandboxRepository)({
						resolveWorkflowCallScript: () => Effect.succeed(null),
						getScriptPin: () =>
							Effect.succeed({
								providerId: null,
								pluginRevision: null,
								scriptSlug: "inline",
								scriptId: inlineScriptId,
								contentHash: "inline-hash",
								metadata: { kind: "operation", capabilities: ["getCachedValue", "setCachedValue"] },
							}),
					}),
					Layer.mock(SandboxWorkflowReferenceRepository)({
						release: () => Effect.die("unused"),
						lockIngestionShared: () => Effect.void,
						registerInTransaction: () => Effect.die("unused"),
					}),
				);
			}),
		),
	),
)((test) => {
	test.effect(
		"journals inline results in order and dispatches only the calls that ended a replay",
		() => {
			const executionId = "inline-workflow";
			const scriptId = inlineScriptId;
			const first = inlineCachedRequest(0, "getCachedValue");
			const second = inlineCachedRequest(1, "setCachedValue");
			const third = inlineCachedRequest(2, "getCachedValue");
			const replayJournalLengths: number[] = [];

			return Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				const result = yield* runSandboxScriptWorkflowBody(
					{
						scriptId,
						input: {},
						executionId,
						resolutionMode: "exact",
						subject: { type: "system" },
					},
					executionId,
					(sandboxPayload) => {
						replayJournalLengths.push(sandboxPayload.journalLength);
						const replay = { logs: [], error: null, harvest: null, status: "completed" as const };
						return Effect.succeed(
							sandboxPayload.journalLength === 0
								? {
										...replay,
										inline: [{ request: first, value: { value: "cached", state: "success" } }],
										value: {
											journalLength: 0,
											state: "pending" as const,
											requests: [first, second],
										},
									}
								: {
										...replay,
										inline: [{ request: third, value: { value: "cached", state: "success" } }],
										value: {
											journalLength: 2,
											output: { done: true },
											state: "completed" as const,
											requests: [first, second, third],
										},
									},
						);
					},
				);

				expect(result).toEqual({ done: true });
				expect(yield* calls.entries("dispatched")).toEqual([1]);
				expect(replayJournalLengths).toEqual([0, 2]);
				expect(yield* calls.entries("projected-high-waters")).toEqual(["0", "2"]);
			});
		},
	);
});

const batchedScriptId = SandboxScriptId.make("workflow-script");
const batchedActivityScriptId = SandboxScriptId.make("activity-script");

layer(
	withWorkflowPinning(
		recordingLayer(
			Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				const allActivitiesStarted = yield* Deferred.make<void>();
				const activeActivities = yield* Ref.make(0);
				return Layer.mergeAll(
					mutationAdmissionTestLayer,
					controlledWorkflowDependencies,
					activityEngineLayer("batched-workflow", {
						execute: (_workflow, options) =>
							Effect.gen(function* () {
								yield* calls.record("child-execution-ids", options.executionId);
								const active = yield* Ref.updateAndGet(activeActivities, (count) => count + 1);
								yield* calls.record("active-activities", active);
								if (active === 2) {
									yield* Deferred.succeed(allActivitiesStarted, undefined);
								}
								yield* Deferred.await(allActivitiesStarted);
								yield* Ref.update(activeActivities, (count) => count - 1);
								return options.executionId;
							}),
					}),
					Layer.mock(SandboxRepository)({
						resolveWorkflowCallScript: () =>
							Effect.succeed({ kind: "script" as const, scriptId: batchedActivityScriptId }),
						getScriptPin: () =>
							Effect.succeed({
								providerId: null,
								pluginRevision: null,
								scriptSlug: "workflow",
								scriptId: batchedScriptId,
								contentHash: "workflow-hash",
								metadata: { kind: "workflow", capabilities: [] },
							}),
					}),
					Layer.mock(SandboxWorkflowReferenceRepository)({
						release: () => Effect.die("unused"),
						lockIngestionShared: () => Effect.void,
						registerInTransaction: () => Effect.die("unused"),
					}),
				);
			}),
		),
	),
)((test) => {
	test.effect("executes a pending batch with request-indexed script child identities", () => {
		const executionId = "batched-workflow";
		const scriptId = batchedScriptId;
		const first = {
			index: 0,
			name: "first",
			kind: "activity" as const,
			args: { input: { value: 1 }, scriptSlug: "activity.first" },
		};
		const second = {
			index: 1,
			name: "second",
			kind: "activity" as const,
			args: { input: { value: 2 }, scriptSlug: "activity.second" },
		};

		return Effect.gen(function* () {
			const calls = yield* WorkflowTestCalls;
			const result = yield* runSandboxScriptWorkflowBody(
				{ scriptId, input: {}, executionId, resolutionMode: "exact", subject: { type: "system" } },
				executionId,
				(sandboxPayload) => {
					if (sandboxPayload.executionId === `${executionId}-replay-0`) {
						return Effect.succeed({
							logs: [],
							inline: [],
							error: null,
							harvest: null,
							status: "completed" as const,
							value: { state: "pending" as const, requests: [first, second] },
						});
					}
					return Effect.succeed({
						logs: [],
						inline: [],
						error: null,
						harvest: null,
						status: "completed" as const,
						value: {
							output: { done: true },
							requests: [first, second],
							state: "completed" as const,
						},
					});
				},
			);

			expect(result).toEqual({ done: true });
			expect(Math.max(...(yield* calls.entries("active-activities")).map(Number))).toBe(2);
			expect((yield* calls.entries("child-execution-ids")).map(String).sort()).toEqual([
				sandboxWorkflowChildExecutionId(executionId, first.name, first.index),
				sandboxWorkflowChildExecutionId(executionId, second.name, second.index),
			]);
		});
	});
});

it.effect("accepts completion output only after the encountered trace matches the journal", () => {
	const request = { index: 0, name: "done", kind: "sleep" as const, args: { durationMs: 10 } };
	return Effect.gen(function* () {
		expect(
			yield* validateWorkflowReplayEnvelope(
				{ state: "completed", requests: [request], output: { done: true } },
				[{ request, value: null }],
				[],
			),
		).toEqual({ state: "completed", output: { done: true } });
	});
});

const childWorkflowEngineLayer = recordingLayer(
	Effect.gen(function* () {
		const calls = yield* WorkflowTestCalls;
		return Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				activityExecute: (activity) =>
					Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
				execute: (workflow, options) =>
					calls
						.record("executed-workflows", workflow)
						.pipe(
							Effect.andThen(calls.record("execute-options", options)),
							Effect.as({ child: true }),
						),
			}),
		);
	}),
);

layer(
	Layer.mergeAll(
		childWorkflowEngineLayer,
		parentInstanceLayer,
		Layer.mock(SandboxArtifactStore)({ retain: () => Effect.void, release: () => Effect.void }),
		Layer.succeed(KernelWorkflowReferences, { execute: () => Effect.die("unused") }),
	),
)((test) => {
	test.effect("dispatches plugin children as child workflows with an exact script pin", () =>
		Effect.gen(function* () {
			const calls = yield* WorkflowTestCalls;
			const result = yield* performSandboxWorkflowChild(
				{
					index: 2,
					kind: "child",
					name: "events/import v1",
					args: { input: { value: 1 }, workflowSlug: "plugin-child" },
				},
				SandboxScriptId.make("child-script"),
				{
					input: {},
					pluginRevision,
					executionId: "parent",
					resolutionMode: "active",
					subject: automationSubject,
					scriptId: SandboxScriptId.make("parent-script"),
				},
				"parent",
			);
			expect(result).toEqual({ child: true });
			expect((yield* calls.entries("executed-workflows")).at(-1)).toBe(SandboxScriptWorkflow);
			expect((yield* calls.entries("execute-options")).at(-1)).toMatchObject({
				executionId: "parent-child-events-import-v1-2",
				payload: {
					resolutionMode: "exact",
					scriptId: "child-script",
					subject: automationSubject,
					grants: { artifactOwnerExecutionId: "parent" },
					pluginRevision: { id: "plugin", revisionId: "revision-1", configRevisionId: "config-1" },
				},
			});
		}),
	);
});

layer(
	Layer.mergeAll(childWorkflowEngineLayer, parentInstanceLayer, controlledWorkflowDependencies),
)((test) => {
	test.effect("dispatches migrated script activity requests as child workflows", () =>
		Effect.gen(function* () {
			const result = yield* performSandboxWorkflowRequest(
				{
					index: 0,
					name: "parse",
					kind: "activity",
					args: { input: {}, scriptSlug: "import.kappa" },
				},
				SandboxScriptId.make("import-script"),
				{
					input: {},
					executionId: "parent",
					resolutionMode: "exact",
					subject: { type: "system" },
					scriptId: SandboxScriptId.make("workflow-script"),
				},
				{
					providerId: null,
					pluginRevision: null,
					scriptSlug: "workflow",
					subject: { type: "system" },
					contentHash: "workflow-hash",
					metadata: { kind: "workflow", capabilities: [] },
					scriptId: SandboxScriptId.make("workflow-script"),
				},
				"parent",
			);

			expect(result).toEqual({ child: true });
			expect((yield* (yield* WorkflowTestCalls).entries("execute-options")).at(-1)).toMatchObject({
				executionId: "parent-child-parse-0",
				payload: { resolutionMode: "exact", scriptId: "import-script" },
			});
		}),
	);
});

layer(
	Layer.mergeAll(
		parentInstanceLayer,
		Layer.mock(SandboxArtifactStore)({ retain: () => Effect.void }),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				execute: () => Effect.die("unused"),
				activityExecute: (activity) =>
					Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
			}),
		),
		recordingLayer(
			Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				return Layer.succeed(KernelWorkflowReferences, {
					execute: (workflowSlug, input, subject, executionId, parentExecutionId, callerScriptId) =>
						calls
							.record("kernel-calls", {
								input,
								subject,
								executionId,
								workflowSlug,
								callerScriptId,
								parentExecutionId,
							})
							.pipe(Effect.as({ status: "completed", entity: { id: "entity-1" } })),
				});
			}),
		),
	),
)((test) => {
	test.effect("dispatches library imports with the parent workflow subject", () =>
		Effect.gen(function* () {
			const result = yield* performSandboxWorkflowChild(
				{
					index: 4,
					kind: "child",
					name: "import-3",
					args: { input: { externalId: "record-1" }, workflowSlug: KERNEL_ENTITY_IMPORT_WORKFLOW },
				},
				undefined,
				{
					input: {},
					executionId: "parent",
					resolutionMode: "active",
					scriptId: SandboxScriptId.make("parent-script"),
					subject: {
						type: "user",
						userId: UserId.make("trusted-user"),
						accountGeneration: {
							token: "test-account-generation",
							userId: UserId.make("trusted-user"),
						},
					},
				},
				"parent",
			);

			expect(result).toEqual({ status: "completed", entity: { id: "entity-1" } });
			expect(yield* (yield* WorkflowTestCalls).entries("kernel-calls")).toEqual([
				{
					parentExecutionId: "parent",
					callerScriptId: "parent-script",
					input: { externalId: "record-1" },
					executionId: "parent-child-import-3-4",
					workflowSlug: KERNEL_ENTITY_IMPORT_WORKFLOW,
					subject: {
						type: "user",
						userId: "trusted-user",
						accountGeneration: {
							token: "test-account-generation",
							userId: UserId.make("trusted-user"),
						},
					},
				},
			]);
		}),
	);
});
