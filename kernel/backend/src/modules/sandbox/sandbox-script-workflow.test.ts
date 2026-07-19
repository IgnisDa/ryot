import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
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
import { Deferred, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { RedisService } from "#lib/infrastructure/redis";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { makeWorkflowReplayJournalHostFunction } from "#lib/infrastructure/sandbox-runtime/workflow-journal";
import { makeActivity } from "#lib/infrastructure/workflow-scope";
import { assertExitFails } from "#lib/test-utils/assertions";
import {
	databaseLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";

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
	establishSandboxWorkflowPin,
	performSandboxWorkflowRequest,
	runSandboxScriptWorkflowBody,
	SANDBOX_WORKFLOW_MAX_STEPS,
	SandboxScriptWorkflow,
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

it.effect(
	"pins retained automation roots without active resolution and preserves serialized ownership",
	() => {
		const requests: unknown[] = [];
		const registrations: unknown[] = [];
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
			const result = yield* establishSandboxWorkflowPin(payload, "execution-1");
			expect(requests).toEqual([
				{
					scriptId: "historical-script",
					expected: { id: "plugin", revisionId: "revision-1", configRevisionId: "config-1" },
				},
			]);
			expect(result.principal).toMatchObject({ pluginRevision, subject: automationSubject });
			expect(registrations).toEqual([
				{
					userId: "user-1",
					pluginId: "plugin",
					allowInactive: true,
					contentHash: "hash-1",
					executionId: "execution-1",
					scriptId: "historical-script",
				},
			]);
			const conflict = yield* Effect.exit(
				establishSandboxWorkflowPin(
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
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					databaseLayer,
					Layer.mock(SandboxPluginScriptResolver)({
						findActiveScriptById: () => Effect.die("Pinned runs must not resolve active scripts"),
					}),
					Layer.mock(SandboxRepository)({
						getScriptPin: (scriptId, expected) =>
							Effect.sync(() => {
								requests.push({ scriptId, expected });
								return {
									scriptId,
									pluginRevision,
									providerId: null,
									scriptSlug: "script",
									contentHash: "hash-1",
									metadata: { kind: "automation" as const },
								};
							}),
					}),
					Layer.mock(SandboxWorkflowReferenceRepository)({
						lockIngestionShared: () => Effect.void,
						registerInTransaction: (input) =>
							Effect.sync(() => {
								registrations.push(input);
								return { status: "registered" as const };
							}),
					}),
				),
			),
		);
	},
);

it.effect("pins source-zero automation by exact script ID without a synthetic plugin", () => {
	const requests: unknown[] = [];
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
		const result = yield* establishSandboxWorkflowPin(payload, "kernel-run");
		expect(requests).toEqual([{ expected: undefined, scriptId: "kernel-notification-v1" }]);
		expect(result).toMatchObject({
			registrationStatus: "not-required",
			principal: {
				pluginRevision: null,
				subject: payload.subject,
				scriptId: "kernel-notification-v1",
			},
		});
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				databaseLayer,
				Layer.mock(SandboxPluginScriptResolver)({
					findActiveScriptById: () =>
						Effect.die("Source-zero runs must not resolve active scripts"),
				}),
				Layer.mock(SandboxRepository)({
					getScriptPin: (scriptId, expected) =>
						Effect.sync(() => {
							requests.push({ scriptId, expected });
							return {
								scriptId,
								providerId: null,
								pluginRevision: null,
								contentHash: "kernel-v1",
								scriptSlug: "notification",
								metadata: { kind: "automation" as const },
							};
						}),
				}),
				Layer.mock(SandboxWorkflowReferenceRepository)({ lockIngestionShared: () => Effect.void }),
			),
		),
	);
});

const makeProjectionRedis = () =>
	makeRedisService({
		client: Object.assign(Object.create(null), {
			eval: () => Promise.resolve(1),
			hgetall: () => Promise.resolve({}),
		}),
	});

const controlledWorkflowDependencies = Layer.mergeAll(
	databaseLayer,
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

it.effect("keeps every shell replay on the initial script pin after an active hot swap", () => {
	const historicalScriptId = SandboxScriptId.make("historical-script-id");
	const replacementScriptId = SandboxScriptId.make("replacement-script-id");
	const request = {
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
	let activeId = historicalScriptId;
	let kernelCallerScriptId: SandboxScriptId | undefined;
	const releases: string[] = [];
	const pinEvents: string[] = [];
	const registrations: unknown[] = [];
	const executedContent: string[] = [];
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
	const script = (id: typeof historicalScriptId, compiledCode: string) => ({
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
	const historical = script(historicalScriptId, historicalContent);
	const replacement = script(replacementScriptId, replacementContent);
	const executionId = "workflow-execution";
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance);
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
	const layer = Layer.mergeAll(
		databaseLayer,
		Layer.succeed(WorkflowEngine, engine),
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(RedisService, makeRedisService({ client: redisClient })),
		Layer.mock(SandboxArtifactStore)({ retain: () => Effect.void, release: () => Effect.void }),
		Layer.mock(SandboxRepository)({
			resolveWorkflowCallScript: () => Effect.succeed(null),
			getScript: (scriptId) =>
				Effect.succeed(scriptId === historicalScriptId ? historical : replacement),
			isPluginScript: () =>
				Effect.sync(() => {
					pinEvents.push("resolve-owned");
					return true;
				}),
			getScriptPin: (scriptId) =>
				Effect.sync(() => {
					pinEvents.push("pin");
					return scriptId === historicalScriptId
						? {
								pluginRevision,
								providerId: null,
								scriptSlug: "workflow",
								scriptId: historicalScriptId,
								contentHash: "historical-hash",
								metadata: { kind: "workflow", capabilities: [] },
							}
						: {
								pluginRevision,
								providerId: null,
								scriptSlug: "workflow",
								scriptId: replacementScriptId,
								contentHash: "replacement-hash",
								metadata: { kind: "workflow", capabilities: [] },
							};
				}),
		}),
		Layer.mock(SandboxPluginScriptResolver)({
			findActiveScriptById: () =>
				Effect.sync(() => {
					pinEvents.push("resolve-active");
					return activeId === historicalScriptId ? historical : replacement;
				}),
		}),
		Layer.mock(SandboxWorkflowReferenceRepository)({
			lockIngestionShared: () => Effect.sync(() => pinEvents.push("lock")),
			release: (registeredExecutionId) =>
				Effect.sync(() => {
					releases.push(registeredExecutionId);
				}),
			registerInTransaction: (input) =>
				Effect.sync(() => {
					pinEvents.push("register");
					registrations.push(input);
					return { status: "registered" as const };
				}),
		}),
		Layer.mock(RuntimeSandboxService)({
			run: (input) =>
				Effect.gen(function* () {
					executedContent.push(input.compiledCode);
					const replayJournal = makeWorkflowReplayJournalHostFunction(input.workflowExecutionId, {
						client: redisClient,
					});
					const journal = yield* replayJournal([]).pipe(Effect.flatMap(replayJournalResult));
					const output = yield* Effect.gen(function* () {
						const process = yield* ChildProcess.make("/bin/sh", ["-c", input.compiledCode], {
							env: {
								REQUEST: encodeJson(request),
								JOURNAL: encodeJson(journal.data.map(({ value }) => value)),
							},
						});
						return yield* process.stdout.pipe(
							Stream.decodeText(),
							Stream.runFold(
								() => "",
								(content, chunk) => content + chunk,
							),
						);
					}).pipe(Effect.scoped, Effect.provide(BunServices.layer));
					activeId = replacementScriptId;
					return {
						logs: [],
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
			) =>
				Effect.sync(() => {
					kernelCallerScriptId = callerScriptId;
					return { kernel: "recorded" };
				}),
		}),
		Layer.mock(SandboxDurableHostDispatcher)({ dispatch: () => Effect.die("unused") }),
	);
	const payload = {
		input: {},
		executionId,
		scriptId: historicalScriptId,
		resultMode: "execution" as const,
		resolutionMode: "active" as const,
		subject: { type: "system" as const },
	};

	return Effect.gen(function* () {
		const result = yield* runSandboxScriptWorkflowBody(payload, executionId, (executionPayload) =>
			executeSandboxExecution(executionPayload).pipe(
				Effect.mapError(
					(error) =>
						new SandboxRunError({ kind: "script-failure", message: unknownToMessage(error) }),
				),
			),
		);
		expect(result).toEqual({
			logs: [],
			error: null,
			status: "completed",
			timing: { totalMs: 1, executionMs: 1 },
			value: { content: "pinned-v1", journal: [{ kernel: "recorded" }] },
		});
		expect(activeId).toBe(replacementScriptId);
		expect(kernelCallerScriptId).toBe(historicalScriptId);
		expect(executedContent).toEqual([historicalContent, historicalContent]);
		expect(executedContent).not.toContain(replacementContent);
		expect(pinEvents.slice(0, 5)).toEqual([
			"lock",
			"resolve-owned",
			"resolve-active",
			"pin",
			"register",
		]);
		expect(registrations).toEqual([
			{
				executionId,
				pluginId: "plugin",
				scriptId: historicalScriptId,
				contentHash: "historical-hash",
			},
		]);
		expect(releases).toEqual([executionId]);
	}).pipe(Effect.provide(layer));
});

it.effect("retains a plugin workflow reference while durably suspended", () => {
	const executionId = "suspended-workflow";
	const scriptId = SandboxScriptId.make("workflow-script");
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	let registrations = 0;
	let releases = 0;
	const engine = makeWorkflowActivityEngine(instance, {
		activityExecute: (activity) =>
			activity.name === "observe-sandbox-workflow-replay-0"
				? Effect.succeed(new Workflow.Suspended())
				: Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
	});
	const layer = Layer.mergeAll(
		databaseLayer,
		controlledWorkflowDependencies,
		Layer.succeed(WorkflowEngine, engine),
		Layer.succeed(WorkflowInstance, instance),
		Layer.mock(SandboxRepository)({
			getScriptPin: () =>
				Effect.succeed({
					scriptId,
					pluginRevision,
					providerId: null,
					scriptSlug: "workflow",
					contentHash: "content-hash",
					metadata: { kind: "workflow", capabilities: [] },
				}),
		}),
		Layer.mock(SandboxWorkflowReferenceRepository)({
			lockIngestionShared: () => Effect.void,
			release: () =>
				Effect.sync(() => {
					releases += 1;
				}),
			registerInTransaction: () =>
				Effect.sync(() => {
					registrations += 1;
					return { status: "registered" as const };
				}),
		}),
	);

	return Effect.gen(function* () {
		const result = yield* Workflow.intoResult(
			runSandboxScriptWorkflowBody(
				{ scriptId, input: {}, executionId, resolutionMode: "exact", subject: { type: "system" } },
				executionId,
				() =>
					Effect.succeed({
						logs: [],
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
		expect(registrations).toBe(1);
		expect(releases).toBe(0);
	}).pipe(Effect.provide(layer));
});

it.effect("reconstructs a completed host write after interruption without repeating it", () => {
	const executionId = "interrupted-host-write";
	const scriptId = SandboxScriptId.make("operation-script");
	const request = {
		index: 0,
		kind: "host" as const,
		name: "setCachedValue",
		args: { capability: "setCachedValue" as const, args: ["write-key", { value: 1 }, 60] as const },
	};
	const activityExits = new Map<string, Exit.Exit<unknown, unknown>>();
	let suspendAfterWrite = true;
	let artifactReleases = 0;
	let artifactRetains = 0;
	let writes = 0;
	const makeEngine = (instance: WorkflowInstance["Service"]) =>
		makeWorkflowActivityEngine(instance, {
			activityExecute: (activity) => {
				if (activity.name === "observe-sandbox-workflow-replay-1" && suspendAfterWrite) {
					suspendAfterWrite = false;
					return Effect.succeed(new Workflow.Suspended());
				}
				const cached = activityExits.get(activity.name);
				if (cached) {
					return Effect.succeed(new Workflow.Complete({ exit: cached }));
				}
				return Effect.map(Effect.exit(activity.execute), (exit) => {
					activityExits.set(activity.name, exit);
					return new Workflow.Complete({ exit });
				});
			},
		});
	const dependencies = (instance: WorkflowInstance["Service"]) =>
		Layer.mergeAll(
			databaseLayer,
			Layer.succeed(WorkflowInstance, instance),
			Layer.succeed(WorkflowEngine, makeEngine(instance)),
			Layer.succeed(RedisService, makeProjectionRedis()),
			Layer.mock(SandboxArtifactStore)({
				retain: () => Effect.sync(() => artifactRetains++).pipe(Effect.asVoid),
				release: () => Effect.sync(() => artifactReleases++).pipe(Effect.asVoid),
			}),
			Layer.mock(SandboxPluginScriptResolver)({ findActiveScriptById: () => Effect.die("unused") }),
			Layer.mock(KernelWorkflowReferences)({ execute: () => Effect.die("unused") }),
			Layer.mock(SandboxRepository)({
				resolveWorkflowCallScript: () => Effect.succeed(null),
				getScriptPin: () =>
					Effect.succeed({
						scriptId,
						providerId: null,
						pluginRevision: null,
						scriptSlug: "workflow",
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
						execute: Effect.sync(() => {
							writes += 1;
							return { value: null, state: "success" as const };
						}),
					}),
			}),
		);
	const payload = {
		scriptId,
		input: {},
		executionId,
		resolutionMode: "exact" as const,
		subject: { type: "user" as const, userId: UserId.make("interrupted-user") },
	};
	const processReplay = (sandboxPayload: SandboxExecutionQueuePayload) =>
		Effect.succeed({
			logs: [],
			error: null,
			harvest: null,
			status: "completed" as const,
			value:
				sandboxPayload.executionId === `${executionId}-replay-0`
					? { requests: [request], state: "pending" as const }
					: { requests: [request], state: "completed" as const, output: { completed: true } },
		});

	return Effect.gen(function* () {
		const firstInstance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
		const first = yield* Workflow.intoResult(
			runSandboxScriptWorkflowBody(payload, executionId, processReplay),
		).pipe(Effect.provide(dependencies(firstInstance)));
		expect(first._tag).toBe("Suspended");
		expect(writes).toBe(1);
		expect(artifactRetains).toBe(1);
		expect(artifactReleases).toBe(0);

		const secondInstance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
		expect(
			yield* runSandboxScriptWorkflowBody(payload, executionId, processReplay).pipe(
				Effect.provide(dependencies(secondInstance)),
			),
		).toEqual({ completed: true });
		expect(writes).toBe(1);
		expect(artifactRetains).toBe(1);
		expect(artifactReleases).toBe(1);
	});
});

it.effect("releases a plugin workflow reference before returning terminal failure", () => {
	const executionId = "failed-workflow";
	const scriptId = SandboxScriptId.make("workflow-script");
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	const events: string[] = [];
	const layer = Layer.mergeAll(
		databaseLayer,
		controlledWorkflowDependencies,
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		Layer.mock(SandboxRepository)({
			getScriptPin: () =>
				Effect.succeed({
					scriptId,
					pluginRevision,
					providerId: null,
					scriptSlug: "workflow",
					contentHash: "content-hash",
					metadata: { kind: "workflow", capabilities: [] },
				}),
		}),
		Layer.mock(SandboxWorkflowReferenceRepository)({
			lockIngestionShared: () => Effect.void,
			release: () => Effect.sync(() => events.push("released")),
			registerInTransaction: () =>
				Effect.sync(() => {
					events.push("registered");
					return { status: "registered" as const };
				}),
		}),
	);

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runSandboxScriptWorkflowBody(
				{ scriptId, input: {}, executionId, resolutionMode: "exact", subject: { type: "system" } },
				executionId,
				() =>
					Effect.succeed({
						logs: [],
						value: null,
						harvest: null,
						status: "completed" as const,
						error: { message: "boom", phase: "execute" as const, kind: "script-failure" as const },
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
		expect(events).toEqual(["registered", "released"]);
	}).pipe(Effect.provide(layer));
});

it.effect("maps inactive plugin pin registration to SandboxRunError", () => {
	const executionId = "inactive-plugin-workflow";
	const scriptId = SandboxScriptId.make("workflow-script");
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	const layer = Layer.mergeAll(
		databaseLayer,
		controlledWorkflowDependencies,
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		Layer.mock(SandboxRepository)({
			getScriptPin: () =>
				Effect.succeed({
					scriptId,
					pluginRevision,
					providerId: null,
					scriptSlug: "workflow",
					contentHash: "content-hash",
					metadata: { kind: "workflow", capabilities: [] },
				}),
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
	);

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runSandboxScriptWorkflowBody(
				{ scriptId, input: {}, executionId, resolutionMode: "exact", subject: { type: "system" } },
				executionId,
				() => Effect.die("unused"),
			),
		);
		assertExitFails(
			exit,
			new SandboxRunError({ kind: "missing-artifact", message: "Plugin 'plugin' is not active" }),
		);
	}).pipe(Effect.provide(layer));
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
			),
		);
		expect(exit.toString()).toContain("replay ended before recorded journal[1]");
	});
});

it.effect("executes a pending batch with request-indexed script child identities", () => {
	const executionId = "batched-workflow";
	const scriptId = SandboxScriptId.make("workflow-script");
	const activityScriptId = SandboxScriptId.make("activity-script");
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
	const childExecutionIds: string[] = [];
	let activeActivities = 0;
	let maxActiveActivities = 0;
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);

	return Effect.gen(function* () {
		const allActivitiesStarted = yield* Deferred.make<void>();
		const layer = Layer.mergeAll(
			databaseLayer,
			controlledWorkflowDependencies,
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowActivityEngine(instance, {
					execute: (_workflow, options) => {
						childExecutionIds.push(options.executionId);
						return Effect.gen(function* () {
							activeActivities += 1;
							maxActiveActivities = Math.max(maxActiveActivities, activeActivities);
							if (activeActivities === 2) {
								yield* Deferred.succeed(allActivitiesStarted, undefined);
							}
							yield* Deferred.await(allActivitiesStarted);
							activeActivities -= 1;
							return options.executionId;
						});
					},
				}),
			),
			Layer.succeed(WorkflowInstance, instance),
			Layer.mock(SandboxRepository)({
				resolveWorkflowCallScript: () =>
					Effect.succeed({ kind: "script" as const, scriptId: activityScriptId }),
				getScriptPin: () =>
					Effect.succeed({
						scriptId,
						providerId: null,
						pluginRevision: null,
						scriptSlug: "workflow",
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
		const result = yield* runSandboxScriptWorkflowBody(
			{ scriptId, input: {}, executionId, resolutionMode: "exact", subject: { type: "system" } },
			executionId,
			(sandboxPayload) => {
				if (sandboxPayload.executionId === `${executionId}-replay-0`) {
					return Effect.succeed({
						logs: [],
						error: null,
						harvest: null,
						status: "completed" as const,
						value: { state: "pending" as const, requests: [first, second] },
					});
				}
				return Effect.succeed({
					logs: [],
					error: null,
					harvest: null,
					status: "completed" as const,
					value: { output: { done: true }, requests: [first, second], state: "completed" as const },
				});
			},
		).pipe(Effect.provide(layer));

		expect(result).toEqual({ done: true });
		expect(maxActiveActivities).toBe(2);
		expect(childExecutionIds.sort()).toEqual([
			sandboxWorkflowChildExecutionId(executionId, first.name, first.index),
			sandboxWorkflowChildExecutionId(executionId, second.name, second.index),
		]);
	});
});

it.effect("accepts completion output only after the encountered trace matches the journal", () => {
	const request = { index: 0, name: "done", kind: "sleep" as const, args: { durationMs: 10 } };
	return Effect.gen(function* () {
		expect(
			yield* validateWorkflowReplayEnvelope(
				{ state: "completed", requests: [request], output: { done: true } },
				[{ request, value: null }],
			),
		).toEqual({ state: "completed", output: { done: true } });
	});
});

it.effect("dispatches plugin children as child workflows with an exact script pin", () => {
	let capturedWorkflow: unknown;
	let capturedOptions: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;
	const engine = makeWorkflowEngine({
		activityExecute: (activity) =>
			Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
		execute: (workflow, options) =>
			Effect.sync(() => {
				capturedWorkflow = workflow;
				capturedOptions = options;
				return { child: true };
			}),
	});

	return Effect.gen(function* () {
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
		expect(capturedWorkflow).toBe(SandboxScriptWorkflow);
		expect(capturedOptions).toMatchObject({
			executionId: "parent-child-events-import-v1-2",
			payload: {
				resolutionMode: "exact",
				scriptId: "child-script",
				subject: automationSubject,
				grants: { artifactOwnerExecutionId: "parent" },
				pluginRevision: { id: "plugin", revisionId: "revision-1", configRevisionId: "config-1" },
			},
		});
	}).pipe(
		Effect.provide(
			Layer.mock(SandboxArtifactStore)({ retain: () => Effect.void, release: () => Effect.void }),
		),
		Effect.provideService(
			WorkflowInstance,
			WorkflowInstance.initial(SandboxScriptWorkflow, "parent"),
		),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(KernelWorkflowReferences, { execute: () => Effect.die("unused") }),
	);
});

it.effect("dispatches migrated script activity requests as child workflows", () => {
	let capturedOptions: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;
	const engine = makeWorkflowEngine({
		activityExecute: (activity) =>
			Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
		execute: (_workflow, options) =>
			Effect.sync(() => {
				capturedOptions = options;
				return { child: true };
			}),
	});

	return Effect.gen(function* () {
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
		expect(capturedOptions).toMatchObject({
			executionId: "parent-child-parse-0",
			payload: { resolutionMode: "exact", scriptId: "import-script" },
		});
	}).pipe(
		Effect.provide(controlledWorkflowDependencies),
		Effect.provideService(
			WorkflowInstance,
			WorkflowInstance.initial(SandboxScriptWorkflow, "parent"),
		),
		Effect.provideService(WorkflowEngine, engine),
	);
});

it.effect("dispatches library imports with the parent workflow subject", () => {
	const calls: Array<{
		input: unknown;
		subject: unknown;
		executionId: string;
		workflowSlug: string;
		callerScriptId: string;
		parentExecutionId: string;
	}> = [];
	return Effect.gen(function* () {
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
				subject: { type: "user", userId: UserId.make("trusted-user") },
			},
			"parent",
		);

		expect(result).toEqual({ status: "completed", entity: { id: "entity-1" } });
		expect(calls).toEqual([
			{
				parentExecutionId: "parent",
				callerScriptId: "parent-script",
				input: { externalId: "record-1" },
				executionId: "parent-child-import-3-4",
				workflowSlug: KERNEL_ENTITY_IMPORT_WORKFLOW,
				subject: { type: "user", userId: "trusted-user" },
			},
		]);
	}).pipe(
		Effect.provide(Layer.mock(SandboxArtifactStore)({ retain: () => Effect.void })),
		Effect.provideService(
			WorkflowInstance,
			WorkflowInstance.initial(SandboxScriptWorkflow, "parent"),
		),
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowEngine({
				execute: () => Effect.die("unused"),
				activityExecute: (activity) =>
					Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
			}),
		),
		Effect.provideService(KernelWorkflowReferences, {
			execute: (workflowSlug, input, subject, executionId, parentExecutionId, callerScriptId) =>
				Effect.sync(() => {
					calls.push({
						input,
						subject,
						executionId,
						workflowSlug,
						callerScriptId,
						parentExecutionId,
					});
					return { status: "completed", entity: { id: "entity-1" } };
				}),
		}),
	);
});
