import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import type { SandboxExecutionPayload } from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import {
	workflowDurableResultSchema,
	workflowReplayJournalEntrySchema,
	workflowReplayEnvelopeSchema,
} from "@ryot/sandbox-sdk/workflow";
import type { Exit } from "effect";
import { Deferred, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { Activity, Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { RedisService } from "#lib/infrastructure/redis";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { makeWorkflowDurableCallsHostFunction } from "#lib/infrastructure/sandbox-runtime/workflow-journal";
import { assertExitFails } from "#lib/test-utils/assertions";
import {
	dbRunnerLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
	transactionLayer,
} from "#lib/test-utils/effect";

import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import { executeSandboxExecution } from "./durable-queues";
import {
	KernelWorkflowReferences,
	KERNEL_ENTITY_IMPORT_WORKFLOW,
} from "./kernel-workflow-references";
import { SandboxPluginScriptResolver } from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";
import {
	performSandboxWorkflowChild,
	performSandboxWorkflowActivity,
	performSandboxWorkflowRequest,
	runSandboxScriptWorkflowBody,
	SANDBOX_WORKFLOW_MAX_STEPS,
	SandboxScriptWorkflow,
	sandboxWorkflowChildExecutionId,
	validateWorkflowReplayEnvelope,
} from "./sandbox-script-workflow";
import {
	SandboxWorkflowReferenceRegistrationError,
	SandboxWorkflowReferenceRepository,
} from "./workflow-reference-repository";

const makeProjectionRedis = () =>
	makeRedisService({
		client: Object.assign(Object.create(null), {
			hmget: () => Promise.resolve([]),
			expire: () => Promise.resolve(1),
			hget: () => Promise.resolve(null),
			pipeline: () => ({
				hset: () => undefined,
				expire: () => undefined,
				hsetnx: () => undefined,
				exec: () => Promise.resolve([]),
			}),
		}),
	});

const controlledWorkflowDependencies = Layer.mergeAll(
	transactionLayer,
	Layer.succeed(RedisService, makeProjectionRedis()),
	Layer.mock(SandboxArtifactStore)({
		retain: () => Effect.void,
		release: () => Effect.void,
	}),
	Layer.mock(SandboxPluginScriptResolver)({
		findActiveScriptById: () => Effect.die("unused"),
	}),
	Layer.mock(KernelWorkflowReferences)({
		execute: () => Effect.die("unused"),
	}),
	Layer.mock(SandboxDurableHostDispatcher)({
		dispatch: () => Effect.die("unused"),
	}),
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

it.effect("propagates trusted grants and journals harvested chunk handles", () => {
	const grants = { artifactPath: "/tmp/trusted-artifact.json" };
	let capturedGrants: SandboxExecutionPayload["grants"];
	let capturedWorkflowExecutionId: SandboxExecutionPayload["workflowExecutionId"];

	return Effect.gen(function* () {
		const result = yield* performSandboxWorkflowActivity(
			{
				index: 0,
				name: "import",
				kind: "activity",
				args: { input: {}, scriptSlug: "activity.import" },
			},
			SandboxScriptId.make("activity-script"),
			{
				grants,
				input: {},
				resolutionMode: "exact",
				authority: { type: "system" },
				executionId: "workflow-execution",
				scriptId: SandboxScriptId.make("workflow-script"),
			},
			"workflow-execution",
			0,
			(payload) => {
				capturedGrants = payload.grants;
				capturedWorkflowExecutionId = payload.workflowExecutionId;
				return Effect.succeed({
					logs: [],
					error: null,
					status: "completed" as const,
					harvest: { chunkHandles: ["harvest-handle-0"] },
					value: {
						requests: [],
						state: "completed" as const,
						output: { count: 2, chunkFiles: ["chunk-0.json"] },
					},
				});
			},
		);

		expect(capturedGrants).toEqual(grants);
		expect(capturedWorkflowExecutionId).toBe("workflow-execution");
		expect(result).toEqual({ count: 2, chunkHandles: ["harvest-handle-0"] });
	});
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
		hget: (key: string, field: string) => Promise.resolve(hashes.get(key)?.get(field) ?? null),
		hmget: (key: string, ...fields: string[]) =>
			Promise.resolve(fields.map((field) => hashes.get(key)?.get(field) ?? null)),
		expire: () => Promise.resolve(1),
		pipeline: () => {
			const writes: Array<() => void> = [];
			return {
				expire: () => undefined,
				hset: (key: string, field: string, value: string) =>
					writes.push(() => {
						const fields = hashes.get(key) ?? new Map<string, string>();
						fields.set(field, value);
						hashes.set(key, fields);
					}),
				hsetnx: (key: string, field: string, value: string) =>
					writes.push(() => {
						const fields = hashes.get(key) ?? new Map<string, string>();
						if (!fields.has(field)) {
							fields.set(field, value);
						}
						hashes.set(key, fields);
					}),
				exec: () => {
					writes.forEach((write) => write());
					return Promise.resolve([]);
				},
			};
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
	const durableCallsResult = Schema.decodeUnknownEffect(
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
		dbRunnerLayer,
		transactionLayer,
		Layer.succeed(WorkflowEngine, engine),
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(RedisService, makeRedisService({ client: redisClient })),
		Layer.mock(SandboxArtifactStore)({
			retain: () => Effect.void,
			release: () => Effect.void,
		}),
		Layer.mock(SandboxRepository)({
			isPluginScript: () =>
				Effect.sync(() => {
					pinEvents.push("resolve-owned");
					return true;
				}),
			getScriptPin: (scriptId) =>
				Effect.sync(() => {
					pinEvents.push("pin");
					return scriptId === historicalScriptId
						? { pluginSlug: "plugin", scriptId: historicalScriptId, contentHash: "historical-hash" }
						: {
								pluginSlug: "plugin",
								scriptId: replacementScriptId,
								contentHash: "replacement-hash",
							};
				}),
			getScript: (scriptId) =>
				Effect.succeed(scriptId === historicalScriptId ? historical : replacement),
			resolveWorkflowCallScript: () => Effect.succeed(null),
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
			registerInTransaction: (input) =>
				Effect.sync(() => {
					pinEvents.push("register");
					registrations.push(input);
					return { status: "registered" as const };
				}),
			release: (registeredExecutionId) =>
				Effect.sync(() => {
					releases.push(registeredExecutionId);
				}),
		}),
		Layer.mock(RuntimeSandboxService)({
			run: (input) =>
				Effect.gen(function* () {
					executedContent.push(input.compiledCode);
					const durableCalls = makeWorkflowDurableCallsHostFunction(input.workflowExecutionId, {
						client: redisClient,
					});
					const journal = yield* durableCalls([]).pipe(Effect.flatMap(durableCallsResult));
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
						timing: { totalMs: 1, executionMs: 1 },
						value: yield* decodeEnvelope(output),
					};
				}).pipe(Effect.orDie),
		}),
		Layer.mock(KernelWorkflowReferences)({
			execute: (
				_workflowSlug,
				_input,
				_authority,
				_executionId,
				_parentExecutionId,
				callerScriptId,
			) =>
				Effect.sync(() => {
					kernelCallerScriptId = callerScriptId;
					return { kernel: "recorded" };
				}),
		}),
		Layer.mock(SandboxDurableHostDispatcher)({
			dispatch: () => Effect.die("unused"),
		}),
	);
	const payload = {
		input: {},
		executionId,
		scriptId: historicalScriptId,
		resolutionMode: "active" as const,
		resultMode: "execution" as const,
		authority: { type: "system" as const },
	};

	return Effect.gen(function* () {
		const result = yield* runSandboxScriptWorkflowBody(payload, executionId, (executionPayload) =>
			executeSandboxExecution(executionPayload).pipe(
				Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
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
				pluginSlug: "plugin",
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
		dbRunnerLayer,
		controlledWorkflowDependencies,
		Layer.succeed(WorkflowEngine, engine),
		Layer.succeed(WorkflowInstance, instance),
		Layer.mock(SandboxRepository)({
			getScriptPin: () =>
				Effect.succeed({ scriptId, pluginSlug: "plugin", contentHash: "content-hash" }),
		}),
		Layer.mock(SandboxWorkflowReferenceRepository)({
			lockIngestionShared: () => Effect.void,
			registerInTransaction: () =>
				Effect.sync(() => {
					registrations += 1;
					return { status: "registered" as const };
				}),
			release: () =>
				Effect.sync(() => {
					releases += 1;
				}),
		}),
	);

	return Effect.gen(function* () {
		const result = yield* Workflow.intoResult(
			runSandboxScriptWorkflowBody(
				{
					scriptId,
					input: {},
					executionId,
					resolutionMode: "exact",
					authority: { type: "system" },
				},
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
									args: { capability: "getCachedValue" as const, args: ["key"] },
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
			dbRunnerLayer,
			transactionLayer,
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
					Effect.succeed({ scriptId, pluginSlug: null, contentHash: "operation-hash" }),
			}),
			Layer.mock(SandboxWorkflowReferenceRepository)({
				lockIngestionShared: () => Effect.void,
				registerInTransaction: () => Effect.die("unused"),
				release: () => Effect.die("unused"),
			}),
			Layer.mock(SandboxDurableHostDispatcher)({
				dispatch: () =>
					Activity.make({
						error: SandboxRunError,
						success: workflowDurableResultSchema,
						name: "sandbox-host-0-setCachedValue",
						execute: Effect.sync(() => {
							writes += 1;
							return { state: "success" as const, value: null };
						}),
					}),
			}),
		);
	const payload = {
		scriptId,
		input: {},
		executionId,
		resolutionMode: "exact" as const,
		authority: { type: "user" as const, userId: UserId.make("interrupted-user") },
	};
	const processReplay = (sandboxPayload: SandboxExecutionPayload) =>
		Effect.succeed({
			logs: [],
			error: null,
			harvest: null,
			status: "completed" as const,
			value:
				sandboxPayload.executionId === `${executionId}-replay-0`
					? { state: "pending" as const, requests: [request] }
					: {
							requests: [request],
							state: "completed" as const,
							output: { completed: true },
						},
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
		dbRunnerLayer,
		controlledWorkflowDependencies,
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		Layer.mock(SandboxRepository)({
			getScriptPin: () =>
				Effect.succeed({ scriptId, pluginSlug: "plugin", contentHash: "content-hash" }),
		}),
		Layer.mock(SandboxWorkflowReferenceRepository)({
			lockIngestionShared: () => Effect.void,
			registerInTransaction: () =>
				Effect.sync(() => {
					events.push("registered");
					return { status: "registered" as const };
				}),
			release: () => Effect.sync(() => events.push("released")),
		}),
	);

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runSandboxScriptWorkflowBody(
				{
					scriptId,
					input: {},
					executionId,
					resolutionMode: "exact",
					authority: { type: "system" },
				},
				executionId,
				() =>
					Effect.succeed({
						logs: [],
						value: null,
						harvest: null,
						status: "completed" as const,
						error: { phase: "execute" as const, message: "boom" },
					}),
			),
		);
		assertExitFails(
			exit,
			new SandboxRunError({ message: "Workflow replay 0 failed: execute: boom" }),
		);
		expect(events).toEqual(["registered", "released"]);
	}).pipe(Effect.provide(layer));
});

it.effect("maps inactive plugin pin registration to SandboxRunError", () => {
	const executionId = "inactive-plugin-workflow";
	const scriptId = SandboxScriptId.make("workflow-script");
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		controlledWorkflowDependencies,
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		Layer.mock(SandboxRepository)({
			getScriptPin: () =>
				Effect.succeed({ scriptId, pluginSlug: "plugin", contentHash: "content-hash" }),
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
				{
					input: {},
					executionId,
					scriptId,
					resolutionMode: "exact",
					authority: { type: "system" },
				},
				executionId,
				() => Effect.die("unused"),
			),
		);
		assertExitFails(exit, new SandboxRunError({ message: "Plugin 'plugin' is not active" }));
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
				{ state: "failed", error: "generic script error", requests: [first, changedSecond] },
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
				{ output: null, journalLength: 0, state: "completed", requests: [first] },
				[
					{ value: null, request: first },
					{ value: null, request: second },
				],
			),
		);
		expect(exit.toString()).toContain("replay ended before recorded journal[1]");
	});
});

it.effect("executes a pending batch with request-indexed activity identities", () => {
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
	const activityExecutionIds: string[] = [];
	let activeActivities = 0;
	let maxActiveActivities = 0;
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		controlledWorkflowDependencies,
		Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		Layer.succeed(WorkflowInstance, instance),
		Layer.mock(SandboxRepository)({
			getScriptPin: () =>
				Effect.succeed({ scriptId, pluginSlug: null, contentHash: "workflow-hash" }),
			resolveWorkflowCallScript: () =>
				Effect.succeed({ kind: "activity" as const, scriptId: activityScriptId }),
		}),
		Layer.mock(SandboxWorkflowReferenceRepository)({
			lockIngestionShared: () => Effect.void,
			registerInTransaction: () => Effect.die("unused"),
			release: () => Effect.die("unused"),
		}),
	);

	return Effect.gen(function* () {
		const allActivitiesStarted = yield* Deferred.make<void>();
		const result = yield* runSandboxScriptWorkflowBody(
			{
				scriptId,
				input: {},
				executionId,
				resolutionMode: "exact",
				authority: { type: "system" },
			},
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
				if (sandboxPayload.executionId === `${executionId}-replay-1`) {
					return Effect.succeed({
						logs: [],
						error: null,
						harvest: null,
						status: "completed" as const,
						value: {
							output: { done: true },
							requests: [first, second],
							state: "completed" as const,
						},
					});
				}
				activityExecutionIds.push(sandboxPayload.executionId);
				return Effect.gen(function* () {
					activeActivities += 1;
					maxActiveActivities = Math.max(maxActiveActivities, activeActivities);
					if (activeActivities === 2) {
						yield* Deferred.succeed(allActivitiesStarted, undefined);
					}
					yield* Deferred.await(allActivitiesStarted);
					activeActivities -= 1;
					return {
						logs: [],
						error: null,
						harvest: null,
						status: "completed" as const,
						value: sandboxPayload.executionId,
					};
				});
			},
		);

		expect(result).toEqual({ done: true });
		expect(maxActiveActivities).toBe(2);
		expect(activityExecutionIds.sort()).toEqual([
			`${executionId}-activity-0`,
			`${executionId}-activity-1`,
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("accepts completion output only after the encountered trace matches the journal", () => {
	const request = { index: 0, name: "done", kind: "sleep" as const, args: { durationMs: 10 } };
	return Effect.gen(function* () {
		expect(
			yield* validateWorkflowReplayEnvelope(
				{ state: "completed", output: { done: true }, requests: [request] },
				[{ value: null, request }],
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
				executionId: "parent",
				resolutionMode: "active",
				authority: { type: "system" },
				scriptId: SandboxScriptId.make("parent-script"),
			},
			"parent",
			2,
		);
		expect(result).toEqual({ child: true });
		expect(capturedWorkflow).toBe(SandboxScriptWorkflow);
		expect(capturedOptions).toMatchObject({
			executionId: "parent-child-events-import-v1-2",
			payload: {
				grants: { artifactOwnerExecutionId: "parent" },
				scriptId: "child-script",
				resolutionMode: "exact",
			},
		});
	}).pipe(
		Effect.provide(
			Layer.mock(SandboxArtifactStore)({
				retain: () => Effect.void,
				release: () => Effect.void,
			}),
		),
		Effect.provideService(
			WorkflowInstance,
			WorkflowInstance.initial(SandboxScriptWorkflow, "parent"),
		),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(KernelWorkflowReferences, {
			execute: () => Effect.die("unused"),
		}),
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
				args: { input: {}, scriptSlug: "import.watcharr" },
			},
			SandboxScriptId.make("import-script"),
			"script",
			{
				input: {},
				executionId: "parent",
				resolutionMode: "exact",
				authority: { type: "system" },
				scriptId: SandboxScriptId.make("workflow-script"),
			},
			"parent",
			0,
			() => Effect.die("unused"),
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

it.effect("dispatches library imports with the parent workflow authority", () => {
	const calls: Array<{
		input: unknown;
		authority: unknown;
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
				args: { input: { externalId: "book-1" }, workflowSlug: KERNEL_ENTITY_IMPORT_WORKFLOW },
			},
			undefined,
			{
				input: {},
				executionId: "parent",
				resolutionMode: "active",
				scriptId: SandboxScriptId.make("parent-script"),
				authority: { type: "user", userId: UserId.make("trusted-user") },
			},
			"parent",
			4,
		);

		expect(result).toEqual({ status: "completed", entity: { id: "entity-1" } });
		expect(calls).toEqual([
			{
				parentExecutionId: "parent",
				input: { externalId: "book-1" },
				callerScriptId: "parent-script",
				executionId: "parent-child-import-3-4",
				workflowSlug: KERNEL_ENTITY_IMPORT_WORKFLOW,
				authority: { type: "user", userId: "trusted-user" },
			},
		]);
	}).pipe(
		Effect.provide(
			Layer.mock(SandboxArtifactStore)({
				retain: () => Effect.void,
			}),
		),
		Effect.provideService(
			WorkflowInstance,
			WorkflowInstance.initial(SandboxScriptWorkflow, "parent"),
		),
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowEngine({
				activityExecute: (activity) =>
					Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
				execute: () => Effect.die("unused"),
			}),
		),
		Effect.provideService(KernelWorkflowReferences, {
			execute: (workflowSlug, input, authority, executionId, parentExecutionId, callerScriptId) =>
				Effect.sync(() => {
					calls.push({
						input,
						authority,
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
