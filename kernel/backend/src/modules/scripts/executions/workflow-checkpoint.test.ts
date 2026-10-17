import { BunServices } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";
import type { WorkflowReplayEnvelope } from "@ryot-app/plugin-backend-sdk/workflow";
import { ExecutionFileStore } from "@ryot-app/sandbox/host/execution-files";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { stubRuntimeSandboxExecutor } from "@ryot-app/sandbox/host/executor.test-support";
import type { SandboxInlineProgress } from "@ryot-app/sandbox/host/inline-progress";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import {
	Cause,
	Deferred,
	Duration,
	Effect,
	Exit,
	Fiber,
	Layer,
	Option,
	Schema,
	type Scope,
} from "effect";
import { PersistedQueue } from "effect/persistence";
import { Reactivity } from "effect/reactivity";
import { DurableClock, DurableDeferred, Workflow } from "effect/workflow";
import {
	type Encoded,
	makeUnsafe,
	WorkflowEngine,
	WorkflowInstance,
} from "effect/workflow/WorkflowEngine";

import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxHttpProgress } from "#modules/scripts/host/http-progress";
import { RedisService } from "#platform/redis";
import { implementWorkflow } from "#platform/workflow/scope";
import { user } from "#schema/tables/auth";
import {
	fakeDatabaseSession,
	makeRedisService,
	makeSqlClusterWorkflowEngine,
} from "#testing/effect";

import { SandboxDurableHostDispatcher } from "../host/durable-dispatcher";
import type { ScriptInlineProgress } from "../host/http-progress";
import { httpProgressPhases } from "../host/http-progress.test-support";
import { KernelWorkflowReferences } from "../registry/kernel-workflow-references";
import { SandboxRepository } from "../registry/repository";
import { SandboxWorkflowReferenceRepository } from "../registry/workflow-references";
import {
	runScriptExecutionWorkflow,
	runScriptExecutionWorkflowBody,
	SandboxWorkflowPinning,
	ScriptExecutionWorkflow,
} from "./workflow";
import type { ScriptExecutionWorkflowPayload } from "./workflow-payload";

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
const sleep0 = { index: 0, name: "sleep-0", kind: "sleep" as const, args: { durationMs: 250 } };
const sleep1 = { index: 1, name: "sleep-1", kind: "sleep" as const, args: { durationMs: 5_000 } };
const sleepRequests = [sleep0, sleep1];
const httpRequest = {
	index: 0,
	name: "httpCall",
	kind: "host" as const,
	args: { capability: "httpCall" as const, args: ["GET", "https://api.test/start"] },
};
const httpDeclaration = {
	requests: 1,
	intervalMs: 1_000,
	key: "http:api.test",
	hash: "checkpoint-hash",
};
const httpProgress = Schema.decodeSync(SandboxHttpProgress)({
	attempt: 1,
	networkAttempt: 2,
	blockWaitAttempt: 3,
	admissionAttempt: 4,
	coordinationAttempt: 5,
	registrationAttempt: 6,
	coordinationBackoffAttempt: 7,
	phase: { rateLimit: null, _tag: "Admitting" },
	current: { hop: 1, headers: {}, method: "GET", url: "https://api.test/redirected" },
	cleanup: {
		declaration: httpDeclaration,
		ticket: {
			lane: "interactive",
			tenant: "checkpoint-tenant",
			plugin: "checkpoint-plugin",
			id: "checkpoint-http-ticket",
		},
	},
});
const httpPending: ScriptInlineProgress = {
	_tag: "Http",
	request: httpRequest,
	progress: httpProgress,
};
const httpResult = { state: "success" as const, value: { body: "ok", status: 200, headers: {} } };
const executionId = "checkpoint-parent";
const scriptId = SandboxScriptId.make("checkpoint-script");
const payload: ScriptExecutionWorkflowPayload = {
	scriptId,
	input: {},
	executionId,
	lane: "interactive",
	resolutionMode: "exact",
	subject: { type: "system" },
};

type SandboxCapabilities = NonNullable<ScriptExecutionPrincipal["metadata"]["capabilities"]>;

type HarnessOptions = {
	readonly capabilities?: SandboxCapabilities;
	readonly dispatcher?: SandboxDurableHostDispatcher["Service"];
};

const makeHarness = (harnessOptions: HarnessOptions = {}) => {
	const activities = new Map<string, Exit.Exit<unknown, unknown>>();
	const slots = new Map<string, Exit.Exit<unknown, unknown>>();
	const childResults = new Map<string, unknown>();
	const dispatches: number[] = [];
	const mutations: number[] = [];
	const interrupted: string[] = [];
	const reads: string[] = [];
	const appends: string[] = [];
	const clockSchedules: Array<ReturnType<typeof DurableClock.make>> = [];
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
			runtimeImports: [],
			kind: "workflow" as const,
			capabilities: harnessOptions.capabilities ?? [],
			executableDependencies: [{ kind: "workflow" as const, slug: firstRequest.args.workflowSlug }],
		},
	};
	const dependencies = Layer.mergeAll(
		Layer.succeed(PersistedQueue.PersistedQueueFactory, {
			make: () => Effect.die("Admission must precede queue access"),
		}),
		Layer.succeed(
			SandboxExecutor,
			stubRuntimeSandboxExecutor(() => Effect.die("Sandbox must not start")),
		),
		Layer.mock(SandboxWorkflowPinning)({
			establish: () => Effect.succeed({ principal, registrationStatus: "not-required" as const }),
		}),
		Layer.mock(ExecutionFileStore)({ retain: () => Effect.void, release: () => Effect.void }),
		Layer.mock(SandboxWorkflowReferenceRepository)({ release: () => Effect.die("unused") }),
		harnessOptions.dispatcher
			? Layer.succeed(SandboxDurableHostDispatcher, harnessOptions.dispatcher)
			: Layer.mock(SandboxDurableHostDispatcher)({
					cancelInline: () => Effect.void,
					dispatch: () => Effect.die("unused"),
				}),
		Layer.mock(SandboxRepository)({ resolveWorkflowCallScript: () => Effect.succeed(null) }),
		Layer.succeed(
			RedisService,
			makeRedisService({
				client: Object.assign(Object.create(null), {
					callBuffer: (
						_command: string,
						_script: string,
						_keys: string,
						_key: string,
						_ttl: string,
						firstIndex: string,
						...entries: Array<string | Buffer>
					) => {
						appends.push(
							`${firstIndex}:${entries.filter((entry) => typeof entry === "string").length}`,
						);
						return Promise.resolve(1);
					},
				}),
			}),
		),
		Layer.mock(KernelWorkflowReferences)({
			execute: (_slug, input, _lane, childId) =>
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
		pendingInline: ReadonlyArray<ScriptInlineProgress> = [],
	) => {
		const instance = WorkflowInstance.initial(ScriptExecutionWorkflow, executionId);
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
			interruptUnsafe: () => Effect.die("unused"),
			interrupt: (_workflow, id) =>
				Effect.sync(() => {
					interrupted.push(id);
				}),
			scheduleClock: (_workflow, scheduled) =>
				Effect.sync(() => {
					clockSchedules.push(scheduled.clock);
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
		const body = runScriptExecutionWorkflowBody(parentPayload, executionId, (replay) =>
			Effect.succeed({
				logs: [],
				inline: [],
				error: null,
				harvest: null,
				status: "completed" as const,
				pendingInline: replay.executionId.endsWith("-replay-0") ? pendingInline : [],
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
		clockSchedules,
	};
};

const completedSleep0: ScriptInlineProgress = { value: null, request: sleep0, _tag: "Completed" };

it.effect("deferred_inline_batch_reuses_completed_members_before_ordered_append", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		const envelope: WorkflowReplayEnvelope = {
			journalLength: 0,
			state: "pending",
			requests: sleepRequests,
		};
		const first = yield* h.fresh(envelope, payload, [completedSleep0]).body;
		assert(first._tag === "Suspended");
		expect([...h.slots.keys()]).toEqual(["sandbox-request-0"]);
		expect(h.clockSchedules.map(({ name }) => name)).toEqual(["sandbox-workflow-sleep-1"]);
		const scheduledClock = h.clockSchedules[0];
		assert(scheduledClock !== undefined);
		expect(Duration.toMillis(scheduledClock.duration)).toBe(5_000);
		expect(h.appends).toEqual([]);

		const clock = DurableClock.make({
			name: "sandbox-workflow-sleep-1",
			duration: Duration.millis(5_000),
		});
		h.slots.set(clock.deferred.name, Exit.succeed(undefined));
		const resumed = yield* h.fresh(envelope).body;
		assert(resumed._tag === "Complete");
		expect(yield* resumed.exit).toBe("done");
		expect(h.clockSchedules.map(({ name }) => name)).not.toContain("sandbox-workflow-sleep-0");
		expect(h.appends).toEqual(["0:2"]);
	}),
);

const invalidInlineProgressCases: ReadonlyArray<{
	readonly label: string;
	readonly entries: ReadonlyArray<ScriptInlineProgress>;
}> = [
	{
		label: "changed name",
		entries: [{ ...completedSleep0, request: { ...sleep0, name: "changed" } }],
	},
	{ label: "changed index", entries: [{ ...completedSleep0, request: { ...sleep0, index: 7 } }] },
	{
		label: "changed args",
		entries: [{ ...completedSleep0, request: { ...sleep0, args: { durationMs: 251 } } }],
	},
	{ label: "duplicate completed entries", entries: [completedSleep0, completedSleep0] },
];

it.effect.each(invalidInlineProgressCases)(
	"deferred_inline_progress_rejects_changed_and_duplicate_request_identity: $label",
	({ entries }) =>
		Effect.gen(function* () {
			const h = makeHarness();
			const envelope: WorkflowReplayEnvelope = {
				journalLength: 0,
				state: "pending",
				requests: sleepRequests,
			};
			const result = yield* h.fresh(envelope, payload, entries).body;
			assert(result._tag === "Complete");
			assertExitFails(
				yield* Effect.exit(result.exit),
				new SandboxRunError({
					kind: "script-failure",
					message: "Sandbox inline progress does not match the pending replay",
				}),
			);
			expect(h.clockSchedules).toEqual([]);
			expect(h.dispatches).toEqual([]);
			expect(h.slots.size).toBe(0);
			expect(h.appends).toEqual([]);
		}),
);

const retainedHttpPhases = httpProgressPhases(httpDeclaration);

it.effect.each(retainedHttpPhases)(
	"deferred_inline_http_passes_retained_$_tag_to_durable_dispatch",
	(phase) =>
		Effect.gen(function* () {
			const progress = { ...httpProgress, phase };
			const dispatchProgress: Array<SandboxHttpProgress | undefined> = [];
			const dispatcher = SandboxDurableHostDispatcher.of({
				cancelInline: () => Effect.void,
				settleInline: () => Effect.die("unused"),
				dispatch: (_request, _payload, _principal, _id, retained) =>
					Effect.sync(() => {
						dispatchProgress.push(retained);
					}).pipe(Effect.andThen(Effect.succeed(httpResult))),
			});
			const h = makeHarness({ dispatcher, capabilities: ["httpCall"] });
			const envelope: WorkflowReplayEnvelope = {
				journalLength: 0,
				state: "pending",
				requests: [httpRequest],
			};
			const first = yield* h.fresh(envelope, payload, [{ ...httpPending, progress }]).body;
			assert(first._tag === "Complete");
			expect(yield* first.exit).toBe("done");
			expect(dispatchProgress).toEqual([progress]);
			const stored = h.slots.get("sandbox-request-0");
			assert(stored !== undefined);
			assert(Exit.isSuccess(stored));
			expect(stored.value).toEqual({
				targetScriptId: null,
				entry: { value: httpResult, request: httpRequest },
			});
			expect(h.appends).toEqual(["0:1"]);

			const resumed = yield* h.fresh(envelope).body;
			assert(resumed._tag === "Complete");
			expect(yield* resumed.exit).toBe("done");
			expect(dispatchProgress).toEqual([progress]);
		}),
);

it.effect("deferred_inline_http_cancels_retained_progress_once_on_parent_interruption", () =>
	Effect.gen(function* () {
		const dispatchStarted = Deferred.makeUnsafe<void>();
		const cancellations: Array<{
			executionId: string;
			progress: ReadonlyArray<SandboxInlineProgress>;
		}> = [];
		const dispatcher = SandboxDurableHostDispatcher.of({
			settleInline: () => Effect.die("unused"),
			dispatch: () =>
				Deferred.succeed(dispatchStarted, undefined).pipe(Effect.andThen(Effect.never)),
			cancelInline: (cancelledExecutionId, progress) =>
				Effect.sync(() => {
					cancellations.push({ progress, executionId: cancelledExecutionId });
				}),
		});
		const h = makeHarness({ dispatcher, capabilities: ["httpCall"] });
		const envelope: WorkflowReplayEnvelope = {
			journalLength: 0,
			state: "pending",
			requests: [httpRequest],
		};
		const attempt = h.fresh(envelope, payload, [httpPending]);
		const running = yield* Effect.forkChild(attempt.body);
		yield* Deferred.await(dispatchStarted);
		attempt.instance.interrupted = true;
		yield* Fiber.interrupt(running);
		expect(cancellations).toEqual([{ executionId, progress: [httpPending] }]);
	}),
);

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

type Harness = ReturnType<typeof makeHarness>;

const primed = (h: Harness) => Effect.asVoid(h.fresh().body);
const settledSlot =
	(request: unknown, targetScriptId: string | null = null) =>
	(h: Harness) =>
		Effect.sync(() => {
			h.slots.set(
				"sandbox-request-0",
				Exit.succeed({ targetScriptId, entry: { request, value: null } }),
			);
		});
const sleepAtZero = { index: 0, name: "child-0", kind: "sleep" as const, args: { durationMs: 0 } };
const pinnedRequests =
	"SandboxWorkflowNondeterminism: replay requests do not match the pinned observation";
const settledIdentity =
	"SandboxWorkflowNondeterminism: settled request[0] identity or pinned target changed";

const divergedTraceCases: ReadonlyArray<{
	readonly label: string;
	readonly message: string;
	readonly dispatches: ReadonlyArray<number>;
	readonly setup: (h: Harness) => Effect.Effect<void, never, Scope.Scope>;
	readonly requests?: ReadonlyArray<typeof firstRequest | typeof sleepAtZero>;
}> = [
	{
		setup: primed,
		dispatches: [0, 1],
		message: pinnedRequests,
		label: "changed name after a cached observation",
		requests: [{ ...firstRequest, name: "changed" }, secondRequest],
	},
	{
		setup: primed,
		dispatches: [0, 1],
		message: pinnedRequests,
		label: "changed args after a cached observation",
		requests: [
			{ ...firstRequest, args: { input: { index: 9 }, workflowSlug: "kernel:entity-import" } },
			secondRequest,
		],
	},
	{
		setup: primed,
		dispatches: [0, 1],
		message: pinnedRequests,
		requests: [sleepAtZero, secondRequest],
		label: "changed kind after a cached observation",
	},
	{
		setup: primed,
		dispatches: [0, 1],
		message: pinnedRequests,
		requests: [firstRequest],
		label: "shortened trace after a cached observation",
	},
	{
		setup: primed,
		dispatches: [0, 1],
		label: "index at the wrong trace position",
		requests: [{ ...firstRequest, index: 1 }, secondRequest],
		message: "SandboxWorkflowNondeterminism: durable call index 1 appeared at trace position 0",
	},
	{
		dispatches: [],
		setup: () => Effect.void,
		label: "duplicate index with an unrecorded first request",
		requests: [firstRequest, secondRequest, { ...secondRequest, name: "third" }],
		message: "SandboxWorkflowNondeterminism: durable call index 1 appeared at trace position 2",
	},
	{
		dispatches: [],
		message: settledIdentity,
		setup: settledSlot(firstRequest, "different-script"),
		label: "pinned target differs from the observed target",
	},
	{
		dispatches: [],
		message: settledIdentity,
		label: "settled slot with a changed name",
		setup: settledSlot({ ...firstRequest, name: "other" }),
	},
	{
		dispatches: [],
		message: settledIdentity,
		label: "settled slot with a changed index",
		setup: settledSlot({ ...firstRequest, index: 7 }),
	},
	{
		dispatches: [],
		message: settledIdentity,
		label: "settled slot with changed args",
		setup: settledSlot({
			...firstRequest,
			args: { input: { index: 8 }, workflowSlug: "kernel:entity-import" },
		}),
	},
	{
		dispatches: [],
		message: settledIdentity,
		setup: settledSlot(sleepAtZero),
		label: "settled slot with a changed kind",
	},
];

it.effect.each(divergedTraceCases)(
	"rejects a diverged trace before it can dispatch or complete: $label",
	({ setup, message, dispatches, requests: diverged }) =>
		Effect.gen(function* () {
			const h = makeHarness();
			yield* setup(h);
			const result = yield* h.fresh(
				diverged && { journalLength: 0, state: "pending", requests: diverged },
			).body;
			assert(result._tag === "Complete");
			assertExitFails(
				yield* Effect.exit(result.exit),
				new SandboxRunError({ message, kind: "script-failure" }),
			);
			expect(h.dispatches).toEqual(dispatches);
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
		assertExitFails(
			yield* Effect.exit(result.exit),
			new SandboxRunError({
				kind: "script-failure",
				message: "Sandbox workflow exceeded the maximum of 1000 durable steps",
			}),
		);
		expect(h.dispatches).toEqual([]);
		expect(h.slots.size).toBe(0);
	}),
);

it.effect("applies the journal entry byte limit to checkpoint hits", () =>
	Effect.gen(function* () {
		const h = makeHarness();
		h.slots.set(
			"sandbox-request-0",
			Exit.succeed({
				targetScriptId: null,
				entry: {
					request: firstRequest,
					value: "x".repeat(SANDBOX_LIMITS.bridge.durableResponseBytes),
				},
			}),
		);
		h.state.blocked = false;
		const result = yield* h.fresh().body;
		assert(result._tag === "Complete");
		assertExitFails(
			yield* Effect.exit(result.exit),
			new SandboxRunError({
				kind: "script-failure",
				message: `Sandbox workflow durable journal entry exceeds ${SANDBOX_LIMITS.bridge.durableResponseBytes} UTF-8 bytes`,
			}),
		);
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
		expect(error.message).toContain("Sandbox workflow durable result is invalid");
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
		const retired: ScriptExecutionWorkflowPayload = {
			...payload,
			subject: {
				userId,
				type: "user",
				accountGeneration: { userId, token: "test-account-generation" },
			},
		};
		const attempt = h.fresh(undefined, retired);
		const exit = yield* attempt.provide(
			Effect.exit(runScriptExecutionWorkflow(retired, executionId)),
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

it.layer(Layer.merge(BunServices.layer, Reactivity.layer), { excludeTestServices: true })(
	(test) => {
		test.effect(
			"reuses a partially settled request through SQL workflow messages and parent resume",
			() =>
				Effect.scoped(
					Effect.gen(function* () {
						const engineLayer = yield* makeSqlClusterWorkflowEngine();
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
									execute: (_slug, input, _lane, childId) =>
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
							ScriptExecutionWorkflow,
							(parentPayload, parentId) =>
								runScriptExecutionWorkflowBody(parentPayload, parentId, (replay) =>
									Effect.succeed({
										logs: [],
										inline: [],
										error: null,
										harvest: null,
										pendingInline: [],
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
									yield* engine.execute(ScriptExecutionWorkflow, {
										payload,
										executionId,
										discard: true,
									});
									const slot = DurableDeferred.make("sandbox-request-0", {
										success: Schema.Unknown,
									});
									yield* Effect.gen(function* () {
										for (;;) {
											const result = yield* engine.poll(ScriptExecutionWorkflow, executionId);
											const completion = yield* engine
												.deferredResult(slot)
												.pipe(
													Effect.provideService(
														WorkflowInstance,
														WorkflowInstance.initial(ScriptExecutionWorkflow, executionId),
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
									yield* engine.resume(ScriptExecutionWorkflow, executionId);
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
										yield* engine.execute(ScriptExecutionWorkflow, { payload, executionId }),
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
					const engineLayer = yield* makeSqlClusterWorkflowEngine();
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
							cancelInline: () => Effect.void,
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
					const parent = implementWorkflow(ScriptExecutionWorkflow, (parentPayload, parentId) =>
						Effect.gen(function* () {
							activations += 1;
							return yield* runScriptExecutionWorkflowBody(parentPayload, parentId, (replay) =>
								Effect.succeed({
									logs: [],
									inline: [],
									error: null,
									harvest: null,
									pendingInline: [],
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
						yield* engine.execute(ScriptExecutionWorkflow, { payload, executionId, discard: true });
						yield* Effect.gen(function* () {
							for (;;) {
								const result = yield* engine.poll(ScriptExecutionWorkflow, executionId);
								const stored = yield* Effect.forEach(calls.slice(0, checkpointCount), ({ index }) =>
									engine
										.deferredResult(
											DurableDeferred.make(`sandbox-request-${index}`, { success: Schema.Unknown }),
										)
										.pipe(
											Effect.provideService(
												WorkflowInstance,
												WorkflowInstance.initial(ScriptExecutionWorkflow, executionId),
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
								workflow: child ? Child : ScriptExecutionWorkflow,
							}),
						});
						expect(yield* engine.execute(ScriptExecutionWorkflow, { payload, executionId })).toBe(
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
