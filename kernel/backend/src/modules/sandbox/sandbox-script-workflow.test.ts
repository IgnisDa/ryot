import { BunServices } from "@effect/platform-bun";
import { expect, it, layer } from "@effect/vitest";
import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { KERNEL_ENTITY_IMPORT_WORKFLOW } from "@ryot-app/contract/modules/plugins/execution";
import {
	AutomationRunId,
	AutomationTriggerId,
	AutomationExecutionId,
	ImportRunId,
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
import { Context, Deferred, Effect, Layer, Metric, Ref, Schema, Stream, type Exit } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { RedisService } from "#lib/infrastructure/redis";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import {
	appendWorkflowJournalWithRedis,
	makeWorkflowReplayJournalHostFunction,
	readWorkflowJournal,
} from "#lib/infrastructure/sandbox-runtime/workflow-journal";
import { makeActivity } from "#lib/infrastructure/workflow-scope";
import { assertExitFails } from "#lib/test-utils/assertions";
import {
	makeRedisService,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
	type WorkflowEngineOverrides,
} from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { testExecutionId, testRedisClient } from "#lib/test-utils/redis";

import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import {
	executeSandboxExecution,
	type SandboxExecutionQueuePayload,
	type SandboxReplayResult,
} from "./durable-queues";
import { KernelWorkflowReferences } from "./kernel-workflow-references";
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
	args: { input: { value: 1 }, workflowSlug: "kernel:event-create" },
};
const historicalContent = `
if [ "$JOURNAL" = "[]" ]; then
  printf '{"state":"pending","journalLength":0,"requests":[%s]}' "$REQUEST"
else
  printf '{"state":"completed","journalLength":1,"requests":[%s],"output":{"content":"pinned-v1","journal":%s}}' "$REQUEST" "$JOURNAL"
fi
`;
const replacementContent = `printf '{"state":"completed","journalLength":0,"requests":[],"output":{"content":"active-v2","journal":[]}}'`;
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
		oauthConnectionFields: [],
		requiredPluginConfigKeys: [],
		optionalPluginConfigKeys: [],
		executableDependencies: [{ kind: "workflow" as const, slug: hotSwapRequest.args.workflowSlug }],
	},
});
const historicalScript = hotSwapScript(historicalScriptId, historicalContent);
const replacementScript = hotSwapScript(replacementScriptId, replacementContent);
const hotSwapExecutionId = testExecutionId("workflow-execution");
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
		const redisClient = yield* testRedisClient;
		const pinOf = (scriptId: SandboxScriptId) =>
			scriptId === historicalScriptId
				? {
						pluginRevision,
						providerId: null,
						scriptSlug: "workflow",
						scriptId: historicalScriptId,
						contentHash: "historical-hash",
						metadata: historicalScript.metadata,
					}
				: {
						pluginRevision,
						providerId: null,
						scriptSlug: "workflow",
						scriptId: replacementScriptId,
						contentHash: "replacement-hash",
						metadata: replacementScript.metadata,
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
						const replayJournal = makeWorkflowReplayJournalHostFunction(input.replayJournal);
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
								journalLength: 0,
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
						? { journalLength: 0, requests: [request], state: "pending" as const }
						: {
								journalLength: 1,
								requests: [request],
								state: "completed" as const,
								output: { completed: true },
							},
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
					journalLength: 2,
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
				{ journalLength: 1, state: "pending", requests: [first, pending, third] },
				[{ value: null, request: first }],
				[],
			),
		).toEqual({ state: "pending", requests: [{ request: pending }, { request: third }] });
	});
});

it.effect("fails as infrastructure when the replay loaded a different journal length", () => {
	const first = { index: 0, name: "first", kind: "sleep" as const, args: { durationMs: 10 } };
	const second = { index: 1, name: "second", kind: "sleep" as const, args: { durationMs: 20 } };
	const journal = [
		{ value: null, request: first },
		{ value: null, request: second },
	];
	return Effect.gen(function* () {
		const pending = yield* Effect.flip(
			validateWorkflowReplayEnvelope(
				{ journalLength: 1, state: "pending", requests: [first] },
				journal,
				[],
			),
		);
		const completed = yield* Effect.flip(
			validateWorkflowReplayEnvelope(
				{ output: null, journalLength: 3, requests: [first], state: "completed" },
				journal,
				[],
			),
		);

		expect(pending).toMatchObject({ kind: "infrastructure" });
		expect(pending.message).toContain("loaded 1 journal entries; expected 2");
		expect(completed).toMatchObject({ kind: "infrastructure" });
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
		expect(detached.toString()).toContain("loaded 0 journal entries; expected 1");
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

const inlineWorkflowLayer = (executionId: string) =>
	withWorkflowPinning(
		recordingLayer(
			Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				const services = yield* Effect.context();
				const redisClient = yield* testRedisClient;
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
								hmget: (key: string, ...fields: string[]) => redisClient.hmget(key, ...fields),
								eval: (script: string, keys: number, key: string, ...args: string[]) =>
									Effect.runPromiseWith(services)(
										args.length > 1
											? calls.record("appends", `${args[1]}:${args.length - 2}`)
											: Effect.void,
									).then(() => redisClient.eval(script, keys, key, ...args)),
							}),
						}),
					),
					Layer.mock(SandboxDurableHostDispatcher)({
						dispatch: (request) =>
							calls
								.record("dispatched", request.index)
								.pipe(Effect.as({ value: "written", state: "success" as const })),
					}),
					activityEngineLayer(executionId),
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
	);

const inlineFirst = inlineCachedRequest(0, "getCachedValue");
const inlineSecond = inlineCachedRequest(1, "setCachedValue");
const inlineThird = inlineCachedRequest(2, "getCachedValue");
const cachedEntry = (request: ReturnType<typeof inlineCachedRequest>) => ({
	request,
	value: { value: "cached", state: "success" as const },
});
const replayBase = { logs: [], error: null, harvest: null, status: "completed" as const };
const firstInlineReplay = {
	...replayBase,
	inline: [cachedEntry(inlineFirst)],
	value: { journalLength: 0, state: "pending" as const, requests: [inlineFirst, inlineSecond] },
};
const projectionMissingReplay = {
	...replayBase,
	inline: [],
	value: null,
	projectionMissing: true as const,
};
const findReplayMetric = (outcome: string) =>
	Effect.map(Metric.snapshot, (snapshots) =>
		snapshots.find(
			(snapshot) =>
				snapshot.id === "ryot.sandbox.workflow_replays" &&
				snapshot.attributes?.["outcome"] === outcome,
		),
	);
const runInlineWorkflow = <R>(
	executionId: string,
	processReplay: (
		payload: SandboxExecutionQueuePayload,
	) => Effect.Effect<SandboxReplayResult, SandboxRunError, R>,
) =>
	runSandboxScriptWorkflowBody(
		{
			input: {},
			executionId,
			resolutionMode: "exact",
			scriptId: inlineScriptId,
			subject: { type: "system" },
		},
		executionId,
		processReplay,
	);

const inlineIds = {
	lost: testExecutionId("inline-lost"),
	race: testExecutionId("inline-race"),
	missing: testExecutionId("inline-missing"),
	ordering: testExecutionId("inline-workflow"),
	recurring: testExecutionId("inline-recurring"),
};

layer(inlineWorkflowLayer(inlineIds.ordering))((test) => {
	test.effect(
		"journals inline results in order and dispatches only the calls that ended a replay",
		() => {
			const replayJournalLengths: number[] = [];

			return Effect.gen(function* () {
				const calls = yield* WorkflowTestCalls;
				const result = yield* runInlineWorkflow(inlineIds.ordering, (sandboxPayload) => {
					replayJournalLengths.push(sandboxPayload.journalLength);
					return Effect.succeed(
						sandboxPayload.journalLength === 0
							? firstInlineReplay
							: {
									...replayBase,
									inline: [cachedEntry(inlineThird)],
									value: {
										journalLength: 2,
										output: { done: true },
										state: "completed" as const,
										requests: [inlineFirst, inlineSecond, inlineThird],
									},
								},
					);
				});

				expect(result).toEqual({ done: true });
				expect(yield* calls.entries("dispatched")).toEqual([1]);
				expect(replayJournalLengths).toEqual([0, 2]);
				expect(yield* calls.entries("appends")).toEqual(["0:2"]);
			});
		},
	);
});

layer(inlineWorkflowLayer(inlineIds.race))((test) => {
	test.effect("loads the enqueued journal when an older activation re-appends a prefix", () =>
		Effect.gen(function* () {
			const calls = yield* WorkflowTestCalls;
			const redis = yield* RedisService;
			yield* runInlineWorkflow(inlineIds.race, (sandboxPayload) => {
				if (sandboxPayload.journalLength === 0) {
					return Effect.succeed(firstInlineReplay);
				}
				return Effect.gen(function* () {
					yield* appendWorkflowJournalWithRedis(redis, inlineIds.race, 0, [
						cachedEntry(inlineFirst),
					]);
					const loaded = yield* readWorkflowJournal(
						redis,
						inlineIds.race,
						sandboxPayload.journalLength,
					);
					yield* calls.record("loaded", loaded);
					return {
						...replayBase,
						inline: [],
						value: {
							output: null,
							journalLength: 2,
							state: "completed" as const,
							requests: [inlineFirst, inlineSecond],
						},
					};
				});
			});

			expect(yield* calls.entries("loaded")).toEqual([
				[
					cachedEntry(inlineFirst),
					{ request: inlineSecond, value: { value: "written", state: "success" } },
				],
			]);
		}),
	);
});

layer(inlineWorkflowLayer(inlineIds.missing))((test) => {
	test.effect("re-appends the full journal and retries after the projection is lost", () =>
		Effect.gen(function* () {
			const calls = yield* WorkflowTestCalls;
			let lost = true;
			const result = yield* runInlineWorkflow(inlineIds.missing, (sandboxPayload) => {
				if (sandboxPayload.journalLength === 0) {
					return Effect.succeed(firstInlineReplay);
				}
				if (lost) {
					lost = false;
					return Effect.succeed(projectionMissingReplay);
				}
				return Effect.succeed({
					...replayBase,
					inline: [],
					value: {
						journalLength: 2,
						output: { done: true },
						state: "completed" as const,
						requests: [inlineFirst, inlineSecond],
					},
				});
			});
			const replays = yield* findReplayMetric("missing");

			expect(result).toEqual({ done: true });
			expect(yield* calls.entries("appends")).toEqual(["0:2", "0:2"]);
			expect(yield* calls.entries("dispatched")).toEqual([1]);
			expect(replays?.state).toMatchObject({ count: 1 });
		}).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
	);
});

layer(inlineWorkflowLayer(inlineIds.lost))((test) => {
	test.effect("fails with resource-unavailable after bounded projection rebuilds", () =>
		Effect.gen(function* () {
			const calls = yield* WorkflowTestCalls;
			let replays = 0;
			const error = yield* Effect.flip(
				runInlineWorkflow(inlineIds.lost, (sandboxPayload) => {
					replays += 1;
					return Effect.succeed(
						sandboxPayload.journalLength === 0 ? firstInlineReplay : projectionMissingReplay,
					);
				}),
			);

			expect(error).toMatchObject({ kind: "resource-unavailable" });
			expect(replays).toBe(4);
			expect(yield* calls.entries("appends")).toEqual(["0:2", "0:2", "0:2"]);
		}),
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
								metadata: {
									kind: "workflow",
									capabilities: [],
									executableDependencies: [
										{ kind: "script", slug: "activity.first" },
										{ kind: "script", slug: "activity.second" },
									],
								},
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
							value: { journalLength: 0, state: "pending" as const, requests: [first, second] },
						});
					}
					return Effect.succeed({
						logs: [],
						inline: [],
						error: null,
						harvest: null,
						status: "completed" as const,
						value: {
							journalLength: 2,
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
				{ journalLength: 1, state: "completed", requests: [request], output: { done: true } },
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
		mutationAdmissionTestLayer,
		parentInstanceLayer,
		Layer.mock(SandboxArtifactStore)({ retain: () => Effect.void, release: () => Effect.void }),
		Layer.succeed(KernelWorkflowReferences, {
			execute: () => Effect.die("unused"),
			resolveArtifactGrants: (_input, _subject, grants) => Effect.succeed(grants),
		}),
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
			const importRunId = ImportRunId.make("run-1");
			const subject = {
				importRunId,
				type: "user" as const,
				userId: UserId.make("user-1"),
				accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
			};
			const result = yield* performSandboxWorkflowRequest(
				{
					index: 0,
					name: "collect",
					kind: "activity",
					args: { input: {}, scriptSlug: "import.collect" },
				},
				SandboxScriptId.make("import-script"),
				{
					subject,
					input: {},
					resolutionMode: "exact",
					executionId: `${importRunId}-import`,
					scriptId: SandboxScriptId.make("workflow-script"),
				},
				{
					subject,
					providerId: null,
					pluginRevision: null,
					scriptSlug: "workflow",
					contentHash: "workflow-hash",
					metadata: { kind: "workflow", capabilities: [] },
					scriptId: SandboxScriptId.make("workflow-script"),
				},
				`${importRunId}-import`,
			);

			expect(result).toEqual({ child: true });
			expect((yield* (yield* WorkflowTestCalls).entries("execute-options")).at(-1)).toMatchObject({
				executionId: "run-1-import-child-collect-0",
				payload: {
					resolutionMode: "exact",
					scriptId: "import-script",
					subject: { type: "user", userId: "user-1", importRunId: "run-1" },
				},
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
					resolveArtifactGrants: (_input, _subject, grants) => Effect.succeed(grants),
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
		mutationAdmissionTestLayer,
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

const recurringRequests = (length: number) => [
	inlineFirst,
	inlineSecond,
	...Array.from({ length: length - 1 }, (_, offset) =>
		inlineCachedRequest(offset + 2, "setCachedValue"),
	),
];

layer(inlineWorkflowLayer(inlineIds.recurring))((test) => {
	test.effect("counts only consecutive projection losses against the rebuild bound", () =>
		Effect.gen(function* () {
			const outcomes = ["missing", "pending", "missing", "pending", "missing", "done"];
			const result = yield* runInlineWorkflow(inlineIds.recurring, (sandboxPayload) => {
				const length = sandboxPayload.journalLength;
				const outcome = length === 0 ? "first" : outcomes.shift();
				if (outcome === "first") {
					return Effect.succeed(firstInlineReplay);
				}
				if (outcome === "missing") {
					return Effect.succeed(projectionMissingReplay);
				}
				return Effect.succeed({
					...replayBase,
					inline: [],
					value:
						outcome === "pending"
							? {
									journalLength: length,
									state: "pending" as const,
									requests: recurringRequests(length),
								}
							: {
									journalLength: length,
									output: { done: true },
									state: "completed" as const,
									requests: recurringRequests(length - 1),
								},
				});
			});

			expect(result).toEqual({ done: true });
		}),
	);
});
