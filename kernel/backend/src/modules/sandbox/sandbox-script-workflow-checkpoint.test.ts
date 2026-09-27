import { BunServices } from "@effect/platform-bun";
import { PgClient } from "@effect/sql-pg";
import { assert, expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import type { WorkflowReplayEnvelope } from "@ryot-app/sandbox-sdk/workflow";
import {
	Cause,
	Deferred,
	Effect,
	Exit,
	Fiber,
	Layer,
	Option,
	Redacted,
	Schema,
	type Scope,
} from "effect";
import { ClusterWorkflowEngine, SingleRunner } from "effect/cluster";
import { PersistedQueue } from "effect/persistence";
import { Reactivity } from "effect/reactivity";
import { DurableDeferred, Workflow } from "effect/workflow";
import {
	type Encoded,
	makeUnsafe,
	WorkflowEngine,
	WorkflowInstance,
} from "effect/workflow/WorkflowEngine";

import { user } from "#lib/infrastructure/db/schema/tables/auth";
import { RedisService } from "#lib/infrastructure/redis";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import { implementWorkflow } from "#lib/infrastructure/workflow-scope";
import { assertExitFails } from "#lib/test-utils/assertions";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { fakeDatabaseSession, makeRedisService } from "#lib/test-utils/effect";

import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import { KernelWorkflowReferences } from "./kernel-workflow-references";
import { SandboxRepository } from "./repository";
import {
	runSandboxScriptWorkflow,
	runSandboxScriptWorkflowBody,
	SandboxScriptWorkflow,
	SandboxWorkflowPinning,
} from "./sandbox-script-workflow";
import type { SandboxScriptWorkflowPayload } from "./sandbox-script-workflow-payload";
import { SandboxWorkflowReferenceRepository } from "./workflow-reference-repository";

const Child = Workflow.make("CheckpointRequestChild", {
	error: SandboxRunError,
	success: jsonValueSchema,
	payload: { index: Schema.Int },
	idempotencyKey: ({ index }) => String(index),
});

const requestAt = (index: number) => ({
	index,
	kind: "child" as const,
	name: `child-${index}`,
	args: { input: { index }, workflowSlug: "kernel:entity-import" },
});
const firstRequest = requestAt(0);
const secondRequest = requestAt(1);
const requests = [firstRequest, secondRequest];
const executionId = "checkpoint-parent";
const scriptId = SandboxScriptId.make("checkpoint-script");
const payload: SandboxScriptWorkflowPayload = {
	scriptId,
	input: {},
	executionId,
	resolutionMode: "exact",
	subject: { type: "system" },
};

const makeHarness = () => {
	const activities = new Map<string, Exit.Exit<unknown, unknown>>();
	const slots = new Map<string, Exit.Exit<unknown, unknown>>();
	const childResults = new Map<string, unknown>();
	const dispatches: number[] = [];
	const mutations: number[] = [];
	const interrupted: string[] = [];
	const reads: string[] = [];
	const appends: string[] = [];
	const state: {
		blocked: boolean;
		retired: boolean;
		beforeStoreCrash: boolean;
		afterStoreCrash: boolean;
		hideReads: number;
		value: unknown;
		waitInChild: boolean;
		forceCacheMiss: boolean;
		childFailure: boolean;
	} = {
		value: null,
		hideReads: 0,
		blocked: true,
		retired: false,
		waitInChild: false,
		childFailure: false,
		forceCacheMiss: false,
		afterStoreCrash: false,
		beforeStoreCrash: false,
	};
	const childStarted = Deferred.makeUnsafe<void>();
	const childRelease = Deferred.makeUnsafe<void>();
	const principal = {
		scriptId,
		providerId: null,
		pluginRevision: null,
		subject: payload.subject,
		scriptSlug: "workflow.checkpoint",
		contentHash: "checkpoint-content",
		metadata: {
			capabilities: [],
			kind: "workflow" as const,
			executableDependencies: [{ kind: "workflow" as const, slug: firstRequest.args.workflowSlug }],
		},
	};
	const dependencies = Layer.mergeAll(
		Layer.succeed(PersistedQueue.PersistedQueueFactory, {
			make: () => Effect.die("Admission must precede queue access"),
		}),
		Layer.mock(SandboxWorkflowPinning)({
			establish: () => Effect.succeed({ principal, registrationStatus: "not-required" as const }),
		}),
		Layer.mock(SandboxArtifactStore)({ retain: () => Effect.void, release: () => Effect.void }),
		Layer.mock(SandboxWorkflowReferenceRepository)({ release: () => Effect.die("unused") }),
		Layer.mock(SandboxDurableHostDispatcher)({ dispatch: () => Effect.die("unused") }),
		Layer.mock(SandboxRepository)({ resolveWorkflowCallScript: () => Effect.succeed(null) }),
		Layer.succeed(
			RedisService,
			makeRedisService({
				client: Object.assign(Object.create(null), {
					eval: (
						_script: string,
						_keys: number,
						_key: string,
						_ttl: string,
						firstIndex: string,
						...entries: string[]
					) => {
						appends.push(`${firstIndex}:${entries.length}`);
						return Promise.resolve(1);
					},
				}),
			}),
		),
		Layer.mock(KernelWorkflowReferences)({
			execute: (_slug, input, _subject, childId) =>
				Effect.gen(function* () {
					const childPayload = yield* Schema.decodeUnknownEffect(Child.payloadSchema)(input).pipe(
						Effect.mapError(
							(error) => new SandboxRunError({ kind: "invalid-input", message: error.message }),
						),
					);
					dispatches.push(childPayload.index);
					return yield* (yield* WorkflowEngine).execute(Child, {
						executionId: childId,
						payload: childPayload,
					});
				}),
		}),
		fakeDatabaseSession({
			select: () => ({
				from: (table: unknown) => ({
					where: () => {
						const rows = Effect.succeed(
							table === user
								? [{ token: state.retired ? "retired-generation" : "test-account-generation" }]
								: [],
						);
						return Object.assign(rows, { for: () => rows, limit: () => rows });
					},
				}),
			}),
		}),
	);
	const fresh = (
		envelope: WorkflowReplayEnvelope = { requests, journalLength: 0, state: "pending" },
		parentPayload = payload,
	) => {
		const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
		function execute<Discard extends boolean>(
			workflow: Parameters<Encoded["execute"]>[0],
			options: Omit<Parameters<Encoded["execute"]>[1], "discard"> & { discard: Discard },
		): Effect.Effect<Discard extends true ? void : Workflow.Result<unknown, unknown>>;
		function execute(
			_workflow: Parameters<Encoded["execute"]>[0],
			options: Parameters<Encoded["execute"]>[1],
		): Effect.Effect<void | Workflow.Result<unknown, unknown>> {
			return Effect.gen(function* () {
				expect(options.parent).toBe(instance);
				if (options.discard) {
					return undefined;
				}
				const { index } = yield* Schema.decodeUnknownEffect(Child.payloadSchema)(
					options.payload,
				).pipe(Effect.orDie);
				if (index === 0 && state.childFailure) {
					return new Workflow.Complete({
						exit: Exit.fail(
							new SandboxRunError({ kind: "script-failure", message: "child-failed" }),
						),
					});
				}
				if (index === 1 && state.waitInChild) {
					yield* Deferred.succeed(childStarted, undefined);
					yield* Deferred.await(childRelease);
				}
				if (index === 1 && state.blocked) {
					return new Workflow.Suspended();
				}
				if (!childResults.has(options.executionId)) {
					mutations.push(index);
					childResults.set(options.executionId, state.value);
				}
				return new Workflow.Complete({ exit: Exit.succeed(childResults.get(options.executionId)) });
			});
		}
		const engine: WorkflowEngine["Service"] = makeUnsafe({
			execute,
			resume: () => Effect.void,
			register: () => Effect.void,
			poll: () => Effect.die("unused"),
			scheduleClock: () => Effect.void,
			interruptUnsafe: () => Effect.die("unused"),
			interrupt: (_workflow, id) =>
				Effect.sync(() => {
					interrupted.push(id);
				}),
			deferredResult: (deferred) =>
				Effect.sync(() => {
					reads.push(deferred.name);
					if (state.forceCacheMiss) {
						return Option.none();
					}
					if (state.hideReads > 0) {
						state.hideReads -= 1;
						return Option.none();
					}
					return Option.fromUndefinedOr(slots.get(deferred.name));
				}),
			deferredDone: (completion) =>
				Effect.gen(function* () {
					expect(completion.executionId).toBe(executionId);
					if (state.beforeStoreCrash) {
						return yield* Effect.die("crash-before-completion");
					}
					if (!slots.has(completion.deferredName)) {
						slots.set(completion.deferredName, completion.exit);
					}
					if (state.afterStoreCrash) {
						return yield* Effect.die("crash-after-completion");
					}
					return undefined;
				}),
			activityExecute: (activity) =>
				Workflow.provideScope(
					Effect.gen(function* () {
						const cached = activities.get(activity.name);
						if (cached) {
							return new Workflow.Complete({ exit: cached });
						}
						const encoded: Effect.Effect<
							unknown,
							SandboxRunError,
							Layer.Success<typeof dependencies> | WorkflowEngine | WorkflowInstance | Scope.Scope
						> = activity.executeEncoded;
						const context = yield* Layer.build(dependencies);
						const exit = yield* encoded.pipe(
							Effect.catch((error: unknown) =>
								Schema.decodeUnknownEffect(SandboxRunError)(error).pipe(
									Effect.orDie,
									Effect.flatMap(Effect.fail),
								),
							),
							Effect.provideContext(context),
							Effect.provideService(WorkflowEngine, engine),
							Effect.provideService(WorkflowInstance, instance),
							Effect.exit,
						);
						activities.set(activity.name, exit);
						return new Workflow.Complete({ exit });
					}),
				),
		});
		const body = runSandboxScriptWorkflowBody(parentPayload, executionId, (replay) =>
			Effect.succeed({
				logs: [],
				inline: [],
				error: null,
				harvest: null,
				status: "completed" as const,
				value: replay.executionId.endsWith("-replay-0")
					? envelope
					: {
							output: "done",
							state: "completed" as const,
							requests: envelope.requests,
							journalLength: replay.journalLength,
						},
			}),
		);
		const provide = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
			const context = yield* Layer.build(dependencies);
			return yield* effect.pipe(
				Effect.provideContext(context),
				Effect.provideService(WorkflowEngine, engine),
				Effect.provideService(WorkflowInstance, instance),
			);
		});
		return { provide, instance, body: provide(Workflow.provideScope(Workflow.intoResult(body))) };
	};
	return {
		state,
		fresh,
		slots,
		reads,
		appends,
		mutations,
		activities,
		dispatches,
		interrupted,
		childStarted,
		dependencies,
	};
};

it.effect(
	"reuses a completed request after its sibling suspends while preserving ordered journal append",
	() =>
		Effect.gen(function* () {
			const h = makeHarness();
			const first = yield* h.fresh().body;
			expect(first._tag).toBe("Suspended");
			expect(h.dispatches).toEqual([0, 1]);
			expect([...h.slots.keys()]).toEqual(["sandbox-request-0"]);
			expect(h.appends).toEqual([]);
			h.state.blocked = false;
			const resumed = yield* h.fresh().body;
			assert(resumed._tag === "Complete");
			expect(yield* resumed.exit).toBe("done");
			expect(h.dispatches).toEqual([0, 1, 1]);
			expect(h.mutations).toEqual([0, 1]);
			expect(h.appends).toEqual(["0:2"]);
		}),
);

it.effect.each([
	{ ...firstRequest, name: "changed" },
	{ ...firstRequest, args: { input: { index: 9 }, workflowSlug: "kernel:entity-import" } },
	{ ...firstRequest, index: 1 },
	{ index: 0, name: "child-0", kind: "sleep" as const, args: { durationMs: 0 } },
])(
	"rejects changed request identity before a cached observation or completion can hide it",
	(changed) =>
		Effect.gen(function* () {
			const h = makeHarness();
			yield* h.fresh().body;
			const result = yield* h.fresh({
				journalLength: 0,
				state: "pending",
				requests: [changed, secondRequest],
			}).body;
			assert(result._tag === "Complete");
			const exit = yield* Effect.exit(result.exit);
			expect(exit.toString()).toContain("SandboxWorkflowNondeterminism");
			expect(h.dispatches).toEqual([0, 1]);
		}),
);

it.effect("validates later duplicate indices even when the first request is unrecorded", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		const result = yield* h.fresh({
			journalLength: 0,
			state: "pending",
			requests: [firstRequest, secondRequest, { ...secondRequest, name: "third" }],
		}).body;
		assert(result._tag === "Complete");
		expect((yield* Effect.exit(result.exit)).toString()).toContain("trace position 2");
		expect(h.dispatches).toEqual([]);
	}),
);

it.effect("rejects a shortened pending trace despite a cached observation and settled prefix", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		yield* h.fresh().body;
		const result = yield* h.fresh({ journalLength: 0, state: "pending", requests: [firstRequest] })
			.body;
		assert(result._tag === "Complete");
		expect((yield* Effect.exit(result.exit)).toString()).toContain("pinned observation");
		expect(h.dispatches).toEqual([0, 1]);
	}),
);

it.effect("rejects a checkpoint whose pinned target differs from the observed target", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		h.slots.set(
			"sandbox-request-0",
			Exit.succeed({
				targetScriptId: "different-script",
				entry: { value: null, request: firstRequest },
			}),
		);
		const result = yield* h.fresh().body;
		assert(result._tag === "Complete");
		expect((yield* Effect.exit(result.exit)).toString()).toContain("pinned target changed");
		expect(h.dispatches).toEqual([]);
	}),
);

it.effect.each([
	{ ...firstRequest, name: "other" },
	{ ...firstRequest, index: 7 },
	{ ...firstRequest, args: { input: { index: 8 }, workflowSlug: "kernel:entity-import" } },
	{ index: 0, name: "child-0", kind: "sleep" as const, args: { durationMs: 0 } },
])("rejects a changed identity stored at the same index slot", (changed) =>
	Effect.gen(function* () {
		const h = makeHarness();
		h.slots.set(
			"sandbox-request-0",
			Exit.succeed({ targetScriptId: null, entry: { value: null, request: changed } }),
		);
		const result = yield* h.fresh().body;
		assert(result._tag === "Complete");
		expect((yield* Effect.exit(result.exit)).toString()).toContain("settled request[0] identity");
		expect(h.dispatches).not.toContain(0);
	}),
);

it.effect("keeps child cancellation attached to the original parent instance", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		h.state.waitInChild = true;
		const attempt = h.fresh();
		const running = yield* Effect.forkChild(attempt.body);
		yield* Deferred.await(h.childStarted);
		attempt.instance.interrupted = true;
		yield* Fiber.interrupt(running);
		expect(h.interrupted).toEqual([`${executionId}-child-child-1-1`]);
		expect([...h.slots.keys()]).toEqual(["sandbox-request-0"]);
	}),
);

it.effect.each(["beforeStoreCrash", "afterStoreCrash"] as const)(
	"recovers %s without replaying an idempotent owner's mutation",
	(window) =>
		Effect.gen(function* () {
			const h = makeHarness();
			h.state[window] = true;
			const failed = yield* Effect.exit(h.fresh().body);
			expect(failed.toString()).toContain(
				window === "beforeStoreCrash" ? "crash-before-completion" : "crash-after-completion",
			);
			expect(h.slots.has("sandbox-request-0")).toBe(window === "afterStoreCrash");
			h.state[window] = false;
			h.state.blocked = false;
			const result = yield* h.fresh().body;
			assert(result._tag === "Complete");
			expect(yield* result.exit).toBe("done");
			expect(h.mutations).toEqual([0, 1]);
			expect(h.dispatches.filter((index) => index === 0)).toHaveLength(
				window === "afterStoreCrash" ? 1 : 2,
			);
		}),
);

it.effect(
	"allows a delayed completion read to repeat dispatch while retaining the owner's result",
	() =>
		Effect.gen(function* () {
			const h = makeHarness();
			yield* h.fresh().body;
			h.state.hideReads = 1;
			h.state.blocked = false;
			const result = yield* h.fresh().body;
			assert(result._tag === "Complete");
			expect(yield* result.exit).toBe("done");
			expect(h.dispatches).toEqual([0, 1, 0, 1]);
			expect(h.mutations).toEqual([0, 1]);
		}),
);

it.effect("allows concurrent misses while deterministic child owners retain the same result", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		h.state.blocked = false;
		h.state.forceCacheMiss = true;
		const results = yield* Effect.all([h.fresh().body, h.fresh().body], {
			concurrency: "unbounded",
		});
		for (const result of results) {
			assert(result._tag === "Complete");
			expect(yield* result.exit).toBe("done");
		}
		expect(h.dispatches.filter((index) => index === 0)).toHaveLength(2);
		expect(h.mutations).toEqual([0, 1]);
		expect([...h.slots.keys()].sort()).toEqual(["sandbox-request-0", "sandbox-request-1"]);
	}),
);

it.effect("does not complete a request whose child effect fails", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		h.state.childFailure = true;
		const result = yield* h.fresh().body;
		assert(result._tag === "Complete");
		assertExitFails(
			yield* Effect.exit(result.exit),
			new SandboxRunError({ kind: "script-failure", message: "child-failed" }),
		);
		expect(h.slots.size).toBe(0);
	}),
);

it.effect("keeps the durable step limit before dispatch or completion", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		const oversized = Array.from({ length: 1_001 }, (_, index) => requestAt(index));
		const result = yield* h.fresh({ journalLength: 0, state: "pending", requests: oversized }).body;
		assert(result._tag === "Complete");
		expect((yield* Effect.exit(result.exit)).toString()).toContain("maximum of 1000 durable steps");
		expect(h.dispatches).toEqual([]);
		expect(h.slots.size).toBe(0);
	}),
);

it.effect("applies the existing ordered journal byte limit to checkpoint hits", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		h.slots.set(
			"sandbox-request-0",
			Exit.succeed({
				targetScriptId: null,
				entry: { request: firstRequest, value: "x".repeat(SANDBOX_LIMITS.journalBytes) },
			}),
		);
		h.state.blocked = false;
		const result = yield* h.fresh().body;
		assert(result._tag === "Complete");
		expect((yield* Effect.exit(result.exit)).toString()).toContain("durable journal exceeds");
		expect(h.appends).toEqual([]);
		expect(h.dispatches).toEqual([1]);
	}),
);

it.effect.each([
	{ value: null },
	{ value: { state: "failure", error: { message: "recorded", data: { reason: "denied" } } } },
])("retains returned JSON value %j", ({ value }) =>
	Effect.gen(function* () {
		const h = makeHarness();
		h.state.value = value;
		yield* h.fresh().body;
		const stored = h.slots.get("sandbox-request-0");
		assert(stored !== undefined);
		assert(Exit.isSuccess(stored));
		expect(stored.value).toEqual({ targetScriptId: null, entry: { value, request: firstRequest } });
	}),
);

it.effect("rejects invalid returned JSON before completing the slot", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		h.state.value = undefined;
		const result = yield* h.fresh().body;
		assert(result._tag === "Complete");
		const exit = yield* Effect.exit(result.exit);
		assert(exit._tag === "Failure");
		const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
		assert(error instanceof SandboxRunError);
		expect(error.kind).toBe("invalid-output");
		expect(exit.toString()).toContain("Sandbox workflow durable result is invalid");
		expect(h.slots.size).toBe(0);
	}),
);

it.effect("checks account generation before a persisted completion can be read", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		yield* h.fresh().body;
		h.state.retired = true;
		const readCount = h.reads.length;
		const userId = UserId.make("retired-checkpoint-user");
		const retired: SandboxScriptWorkflowPayload = {
			...payload,
			subject: {
				userId,
				type: "user",
				accountGeneration: { userId, token: "test-account-generation" },
			},
		};
		const attempt = h.fresh(undefined, retired);
		const exit = yield* attempt.provide(
			Effect.exit(runSandboxScriptWorkflow(retired, executionId)),
		);
		assertExitFails(
			exit,
			new SandboxRunError({
				kind: "infrastructure",
				message: "Mutation command belongs to a retired account",
			}),
		);
		expect(h.reads).toHaveLength(readCount);
	}),
);

const makeSqlClusterEngine = Effect.fnUntraced(function* () {
	const admin = yield* PgClient.make({ url: Redacted.make(testDatabaseUrl()) });
	const schemaName = `checkpoint_${crypto.randomUUID().replaceAll("-", "")}`;
	yield* Effect.acquireRelease(admin.unsafe(`CREATE SCHEMA "${schemaName}"`), () =>
		admin.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`).pipe(Effect.orDie),
	);
	return ClusterWorkflowEngine.layer.pipe(
		Layer.provide(
			SingleRunner.layer({
				runnerStorage: "sql",
				shardingConfig: { shardLockDisableAdvisory: true },
			}),
		),
		Layer.provide(
			PgClient.layer({
				url: Redacted.make(testDatabaseUrl()),
				startupParameters: { search_path: schemaName },
			}),
		),
		Layer.provide(BunServices.layer),
	);
});

it.layer(Layer.merge(BunServices.layer, Reactivity.layer), { excludeTestServices: true })(
	(test) => {
		test.effect(
			"reuses a partially settled request through SQL workflow messages and parent resume",
			() =>
				Effect.scoped(
					Effect.gen(function* () {
						const engineLayer = yield* makeSqlClusterEngine();
						const h = makeHarness();
						const dispatches: number[] = [];
						const resumed = yield* Deferred.make<void>();
						const childReady = DurableDeferred.make("ready", { success: Schema.Void });
						const references = Layer.effect(
							KernelWorkflowReferences,
							Effect.gen(function* () {
								const engine = yield* WorkflowEngine;
								return KernelWorkflowReferences.of({
									resolveArtifactGrants: (_input, _subject, grants) => Effect.succeed(grants),
									execute: (_slug, input, _subject, childId) =>
										Effect.gen(function* () {
											const childPayload = yield* Schema.decodeUnknownEffect(Child.payloadSchema)(
												input,
											).pipe(Effect.orDie);
											dispatches.push(childPayload.index);
											if (
												childPayload.index === 1 &&
												dispatches.filter((index) => index === 1).length > 1
											) {
												yield* Deferred.succeed(resumed, undefined);
											}
											return yield* engine.execute(Child, {
												executionId: childId,
												payload: childPayload,
											});
										}),
								});
							}),
						);
						const parentLayer = implementWorkflow(
							SandboxScriptWorkflow,
							(parentPayload, parentId) =>
								runSandboxScriptWorkflowBody(parentPayload, parentId, (replay) =>
									Effect.succeed({
										logs: [],
										inline: [],
										error: null,
										harvest: null,
										status: "completed" as const,
										value: replay.executionId.endsWith("-replay-0")
											? { requests, journalLength: 0, state: "pending" }
											: {
													requests,
													output: "done",
													state: "completed",
													journalLength: replay.journalLength,
												},
									}),
								),
						);
						const childLayer = implementWorkflow(Child, ({ index }) =>
							Effect.gen(function* () {
								if (index === 1) {
									yield* DurableDeferred.await(childReady);
								}
								return null;
							}),
						);
						const workflows = Layer.mergeAll(parentLayer, childLayer).pipe(
							Layer.provide(references.pipe(Layer.provide(engineLayer))),
							Layer.provide(h.dependencies),
							Layer.provideMerge(engineLayer),
						);
						yield* Layer.build(workflows).pipe(
							Effect.flatMap((context) =>
								Effect.gen(function* () {
									const engine = yield* WorkflowEngine;
									yield* engine.execute(SandboxScriptWorkflow, {
										payload,
										executionId,
										discard: true,
									});
									const slot = DurableDeferred.make("sandbox-request-0", {
										success: Schema.Unknown,
									});
									yield* Effect.gen(function* () {
										for (;;) {
											const result = yield* engine.poll(SandboxScriptWorkflow, executionId);
											const completion = yield* engine
												.deferredResult(slot)
												.pipe(
													Effect.provideService(
														WorkflowInstance,
														WorkflowInstance.initial(SandboxScriptWorkflow, executionId),
													),
												);
											if (
												Option.isSome(result) &&
												result.value._tag === "Suspended" &&
												Option.isSome(completion)
											) {
												break;
											}
											yield* Effect.sleep("20 millis");
										}
									}).pipe(Effect.timeout("10 seconds"));
									const completedDispatches = dispatches.filter((index) => index === 0).length;
									yield* engine.resume(SandboxScriptWorkflow, executionId);
									yield* Deferred.await(resumed).pipe(Effect.timeout("10 seconds"));
									expect(dispatches.filter((index) => index === 0)).toHaveLength(
										completedDispatches,
									);
									const token = DurableDeferred.tokenFromExecutionId(childReady, {
										workflow: Child,
										executionId: `${executionId}-child-child-1-1`,
									});
									yield* DurableDeferred.succeed(childReady, { token, value: undefined });
									expect(
										yield* engine.execute(SandboxScriptWorkflow, { payload, executionId }),
									).toBe("done");
								}).pipe(Effect.provideContext(context)),
							),
							Effect.timeout("15 seconds"),
						);
					}),
				),
		);
		test.effect.each([
			{ child: false, checkpointCount: 0, kind: "awaited signal" },
			{ child: true, checkpointCount: 0, kind: "child reply" },
			{ child: false, checkpointCount: 3, kind: "unawaited checkpoints" },
		])("keeps only necessary app body activations for $kind", ({ child, checkpointCount }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const engineLayer = yield* makeSqlClusterEngine();
					const h = makeHarness();
					const signal = DurableDeferred.make("checkpoint-test-release", { success: Schema.Void });
					const checkpointsReady = yield* Deferred.make<void>();
					const childId = "checkpoint-wake-child";
					const calls = Array.from({ length: checkpointCount + 1 }, (_, index) => ({
						index,
						kind: "host" as const,
						name: "getCachedValue",
						args: { args: [index], capability: "getCachedValue" as const },
					}));
					let activations = 0;
					const dispatcher = Layer.succeed(
						SandboxDurableHostDispatcher,
						SandboxDurableHostDispatcher.of({
							settleInline: () => Effect.die("unused"),
							dispatch: ({ index }) =>
								Effect.gen(function* () {
									if (index === checkpointCount) {
										// Persist the prefix before this request can suspend its siblings.
										yield* Deferred.await(checkpointsReady);
										if (child) {
											yield* (yield* WorkflowEngine).execute(Child, {
												payload: { index },
												executionId: childId,
											});
										} else {
											yield* DurableDeferred.await(signal);
										}
									}
									return { value: null, state: "success" as const };
								}),
						}),
					);
					const parent = implementWorkflow(SandboxScriptWorkflow, (parentPayload, parentId) =>
						Effect.gen(function* () {
							activations += 1;
							return yield* runSandboxScriptWorkflowBody(parentPayload, parentId, (replay) =>
								Effect.succeed({
									logs: [],
									inline: [],
									error: null,
									harvest: null,
									status: "completed" as const,
									value: replay.executionId.endsWith("-replay-0")
										? { requests: calls, journalLength: 0, state: "pending" }
										: {
												output: "done",
												requests: calls,
												state: "completed",
												journalLength: replay.journalLength,
											},
								}),
							);
						}),
					);
					const childWorkflow = implementWorkflow(Child, () =>
						DurableDeferred.await(signal).pipe(Effect.as(null)),
					);
					const workflows = Layer.merge(parent, childWorkflow).pipe(
						Layer.provide(dispatcher),
						Layer.provide(h.dependencies),
						Layer.provideMerge(engineLayer),
					);
					const context = yield* Layer.build(workflows);
					yield* Effect.gen(function* () {
						const engine = yield* WorkflowEngine;
						yield* engine.execute(SandboxScriptWorkflow, { payload, executionId, discard: true });
						yield* Effect.gen(function* () {
							for (;;) {
								const result = yield* engine.poll(SandboxScriptWorkflow, executionId);
								const stored = yield* Effect.forEach(calls.slice(0, checkpointCount), ({ index }) =>
									engine
										.deferredResult(
											DurableDeferred.make(`sandbox-request-${index}`, { success: Schema.Unknown }),
										)
										.pipe(
											Effect.provideService(
												WorkflowInstance,
												WorkflowInstance.initial(SandboxScriptWorkflow, executionId),
											),
										),
								);
								if (stored.every(Option.isSome)) {
									yield* Deferred.succeed(checkpointsReady, undefined);
								}
								if (
									Option.isSome(result) &&
									result.value._tag === "Suspended" &&
									stored.every(Option.isSome)
								) {
									break;
								}
								yield* Effect.sleep("20 millis");
							}
						}).pipe(Effect.timeout("5 seconds"));
						const beforeRelease = activations;
						yield* DurableDeferred.succeed(signal, {
							value: undefined,
							token: DurableDeferred.tokenFromExecutionId(signal, {
								executionId: child ? childId : executionId,
								workflow: child ? Child : SandboxScriptWorkflow,
							}),
						});
						expect(yield* engine.execute(SandboxScriptWorkflow, { payload, executionId })).toBe(
							"done",
						);
						expect({ beforeRelease, afterRelease: activations }).toEqual({
							afterRelease: 2,
							beforeRelease: 1,
						});
					}).pipe(Effect.provideContext(context));
				}),
			).pipe(Effect.timeout("10 seconds")),
		);
	},
);
