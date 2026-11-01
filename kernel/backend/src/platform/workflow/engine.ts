import { PgClient } from "@effect/sql-pg";
import { DbError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import {
	Cause,
	Clock,
	Context,
	DateTime,
	Deferred,
	Duration,
	Effect,
	Exit,
	Fiber,
	FiberMap,
	Layer,
	Option,
	Schedule,
	Schema,
	Scope,
	Stream,
} from "effect";
import { SecureRandom } from "effect/crypto";
import { Activity, DurableDeferred, Workflow } from "effect/workflow";
import {
	type Encoded as WorkflowEngineEncoded,
	makeDeferredState,
	makeUnsafe,
	WorkflowEngine,
	WorkflowInstance,
} from "effect/workflow/WorkflowEngine";

import { WorkflowAccountRejected, WorkflowAccounts, WorkflowAdmissionAccount } from "./account";
import {
	type ExecutionRow,
	type StepRow,
	WorkflowEngineStore,
	WorkflowWake,
	workflowWakeChannel,
} from "./engine-store";
import { WorkflowExecutionNotifications } from "./execution-notifications";
import { WorkflowExecutionExpired, type WorkflowIdentity } from "./identity";
import { WorkflowCodecs } from "./scope";

const LEASE = Duration.seconds(10);
const RENEW_EVERY = Duration.seconds(3);
const SWEEP_EVERY = Duration.seconds(5);
const SWEEP_LIMIT = 100;

// The interrupt is recorded as this deferred, so kernel code can read it through `deferredResult`.
const InterruptSignal = DurableDeferred.make("Workflow/InterruptSignal");

const AnyOrVoid = Schema.Union([Schema.Any, Schema.Void]);
const ExitJson = Schema.toCodecJson(Schema.Exit(AnyOrVoid, AnyOrVoid, Schema.Any));
const ActivityResultJson = Schema.toCodecJson(
	Workflow.Result({ error: AnyOrVoid, success: AnyOrVoid }),
);
// Stored JSON drops `undefined`, so a void success or failure loses its `value` or `error` key.
const restoreExit = (json: unknown): unknown => {
	if (!isObjectRecord(json)) {
		return json;
	}
	if (json["_tag"] === "Success") {
		return { value: undefined, ...json };
	}
	return json["_tag"] === "Failure" && Array.isArray(json["cause"])
		? {
				...json,
				cause: json["cause"].map((reason: unknown) =>
					isObjectRecord(reason) && reason["_tag"] === "Fail"
						? { error: undefined, ...reason }
						: reason,
				),
			}
		: json;
};
const encodeExit = (exit: Exit.Exit<unknown, unknown>) =>
	Schema.encodeEffect(ExitJson)(exit).pipe(Effect.orDie);
const decodeExit = (json: unknown) =>
	Schema.decodeUnknownEffect(ExitJson)(restoreExit(json)).pipe(Effect.orDie);
const encodeActivityResult = (result: Result) =>
	Schema.encodeEffect(ActivityResultJson)(result).pipe(Effect.orDie);
const decodeActivityResult = (json: unknown) =>
	Schema.decodeUnknownEffect(ActivityResultJson)(
		isObjectRecord(json) && json["_tag"] === "Complete"
			? { ...json, exit: restoreExit(json["exit"]) }
			: json,
	).pipe(Effect.orDie);

type WakeMode = "explicit" | "automatic";
type Result = Workflow.Result<unknown, unknown>;
type Execute = (
	payload: object,
	executionId: string,
) => Effect.Effect<unknown, unknown, WorkflowEngine | WorkflowInstance>;
type ExecuteOptions<Discard extends boolean> = { readonly discard: Discard } & Omit<
	Parameters<WorkflowEngineEncoded["execute"]>[1],
	"discard"
>;

const keyOf = ({ executionId, workflowName }: WorkflowIdentity) =>
	`${workflowName}\u0000${executionId}`;
const activityKey = (name: string, attempt: number) => `${name}/${attempt}`;
const clockKey = (identity: WorkflowIdentity, name: string) => `${keyOf(identity)}\u0000${name}`;

type Registration = {
	readonly execute: Execute;
	readonly scope: Scope.Scope;
	readonly workflow: Workflow.Any;
	readonly codecs: undefined | WorkflowCodecs;
};

type Activation = {
	interrupted: boolean;
	readonly payload: object;
	readonly execute: Execute;
	interruptedUnsafe: boolean;
	readonly codecs: WorkflowCodecs;
	readonly workflow: Workflow.Any;
	// Parent of every run's scope; scopes of suspended runs stay open until the execution ends.
	readonly scope: Scope.Closeable;
	account: null | AccountGeneration;
	readonly identity: WorkflowIdentity;
	instance: WorkflowInstance["Service"];
	resumeRequested: WakeMode | undefined;
	fiber: undefined | Fiber.Fiber<Result>;
	readonly activities: Map<string, Result>;
	readonly done: Deferred.Deferred<Result>;
	// Suspension recorded before this process loaded the execution; decides its first wake.
	loadedSuspension: ExecutionRow["suspension"];
	readonly parent: undefined | WorkflowIdentity;
	readonly deferreds: Map<string, Exit.Exit<unknown, unknown>>;
};

const expired = (identity: WorkflowIdentity) => Effect.die(new WorkflowExecutionExpired(identity));

const rejected = (message: string) => Effect.die(new WorkflowAccountRejected({ message }));

const accountOf = (row: ExecutionRow): null | AccountGeneration =>
	row.accountUserId === null || row.accountToken === null
		? null
		: { token: row.accountToken, userId: row.accountUserId };

const sameAccount = (left: null | AccountGeneration, right: null | AccountGeneration) =>
	left?.userId === right?.userId && left?.token === right?.token;

const isUnwakeable = (result: Result, mode: WakeMode) =>
	result._tag === "Complete" || (mode === "automatic" && result.failed === true);

export const makePostgresWorkflowEngine = Effect.gen(function* () {
	const scope = yield* Effect.scope;
	const store = yield* WorkflowEngineStore;
	const retirement = (account: AccountGeneration) =>
		Effect.map(store.accountRetired(account), (retired) =>
			retired
				? "Mutation command belongs to a retired account"
				: "Mutation command account is being retired",
		);
	const notifications = yield* WorkflowExecutionNotifications;
	const pg = yield* PgClient.PgClient;
	const owner = `runner-${yield* (yield* SecureRandom.SecureRandom).uuidV4()}`;
	const leaseMs = Duration.toMillis(LEASE);

	const workflows = new Map<string, Registration>();
	const activations = new Map<string, Activation>();
	const deferredState = makeDeferredState();
	const clocks = yield* FiberMap.make<string>();

	const unadmitted = Effect.die(
		new DbError({ message: "Workflow message has no admitted execution" }),
	);
	const codecsOf = (tag: string) => {
		const codecs = workflows.get(tag)?.codecs;
		return codecs
			? Effect.succeed(codecs)
			: Effect.die(`Workflow ${tag} must be registered with implementWorkflow`);
	};

	const loadSteps = Effect.fnUntraced(function* (
		activation: Activation,
		rows: ReadonlyArray<StepRow>,
	) {
		for (const row of rows) {
			if (row.kind === "activity" && row.exit !== null) {
				activation.activities.set(
					activityKey(row.name, row.attempt),
					yield* decodeActivityResult(row.exit),
				);
			} else if (
				row.kind === "deferred" &&
				row.exit !== null &&
				!activation.deferreds.has(row.name)
			) {
				activation.deferreds.set(row.name, yield* decodeExit(row.exit));
			}
		}
		activation.interrupted ||= activation.deferreds.has(InterruptSignal.name);
	});

	const armClock = (identity: WorkflowIdentity, name: string, fireAt: Date): Effect.Effect<void> =>
		Effect.gen(function* () {
			const delay = Math.max(0, fireAt.getTime() - (yield* Clock.currentTimeMillis));
			yield* Effect.sleep(Duration.millis(delay));
			yield* store.fireClock(identity, name);
			yield* deferredDone({
				exit: Exit.void,
				executionId: identity.executionId,
				workflowName: identity.workflowName,
				deferredName: `DurableClock/${name}`,
			});
		}).pipe(FiberMap.run(clocks, clockKey(identity, name), { onlyIfMissing: true }), Effect.asVoid);

	// Builds the in-memory activation of an execution this process owns, from its stored row.
	const activate = Effect.fnUntraced(function* (
		row: ExecutionRow,
		steps: ReadonlyArray<StepRow>,
	): Effect.fn.Return<undefined | Activation> {
		const identity = { executionId: row.executionId, workflowName: row.workflowName };
		const existing = activations.get(keyOf(identity));
		if (existing) {
			return existing;
		}
		const entry = workflows.get(row.workflowName);
		if (!entry?.codecs || row.payload === null) {
			return undefined;
		}
		const payload = yield* entry.codecs.decodePayload(row.payload).pipe(Effect.orDie);
		const activation: Activation = {
			payload,
			identity,
			fiber: undefined,
			interrupted: false,
			codecs: entry.codecs,
			deferreds: new Map(),
			activities: new Map(),
			execute: entry.execute,
			account: accountOf(row),
			workflow: entry.workflow,
			interruptedUnsafe: false,
			scope: Scope.makeUnsafe(),
			resumeRequested: undefined,
			done: Deferred.makeUnsafe(),
			loadedSuspension: row.suspension,
			instance: WorkflowInstance.initial(entry.workflow, identity.executionId),
			parent:
				row.parentWorkflowName !== null && row.parentExecutionId !== null
					? { executionId: row.parentExecutionId, workflowName: row.parentWorkflowName }
					: undefined,
		};
		yield* loadSteps(activation, steps);
		activations.set(keyOf(identity), activation);
		for (const step of steps) {
			if (step.kind === "clock" && step.exit === null && step.fireAt !== null) {
				yield* armClock(identity, step.name, step.fireAt);
			}
		}
		return activation;
	});

	const wakeParent = (parent: WorkflowIdentity) =>
		activations.has(keyOf(parent)) ? resume(parent, "automatic") : store.notify(parent);

	const settle = Effect.fnUntraced(function* (activation: Activation, result: Result) {
		if (result._tag === "Suspended") {
			yield* store.suspend(activation.identity, result.failed === true ? "failed" : "waiting");
			return;
		}
		const encoded = yield* activation.codecs.encodeResult(result).pipe(Effect.orDie);
		yield* store.complete({
			owner,
			result: encoded,
			identity: activation.identity,
			succeeded: result.exit._tag === "Success",
			completedAt: DateTime.toDate(yield* DateTime.now),
		});
		const armed = clockKey(activation.identity, "");
		for (const [key] of clocks) {
			if (key.startsWith(armed)) {
				yield* FiberMap.remove(clocks, key);
			}
		}
		activations.delete(keyOf(activation.identity));
		yield* Deferred.succeed(activation.done, result);
		yield* notifications.publish(activation.identity).pipe(Effect.ignore);
		if (activation.parent) {
			yield* wakeParent(activation.parent);
		}
	});

	const resume = (identity: WorkflowIdentity, mode: WakeMode): Effect.Effect<void> =>
		Effect.suspend(() => {
			const activation = activations.get(keyOf(identity));
			if (!activation) {
				return Effect.void;
			}
			const exit = activation.fiber?.pollUnsafe();
			if (exit?._tag === "Success" && isUnwakeable(exit.value, mode)) {
				return Effect.void;
			}
			if (!activation.fiber && mode === "automatic" && activation.loadedSuspension === "failed") {
				return Effect.void;
			}
			if (activation.fiber && !exit) {
				const requested = activation.resumeRequested;
				activation.resumeRequested = mode === "explicit" ? mode : (requested ?? mode);
				if (requested !== undefined) {
					return Effect.void;
				}
				const running = activation.fiber;
				return Fiber.await(running).pipe(
					Effect.flatMap(() => {
						const next = activation.resumeRequested ?? mode;
						activation.resumeRequested = undefined;
						return resume(identity, next);
					}),
					Effect.forkIn(scope),
					Effect.asVoid,
				);
			}
			return startRun(activation);
		});

	const startRun = Effect.fnUntraced(function* (activation: Activation) {
		const entry = workflows.get(activation.workflow._tag);
		if (!entry) {
			return;
		}
		if (activation.loadedSuspension === "failed") {
			yield* store.suspend(activation.identity, null);
		}
		activation.loadedSuspension = null;
		// Each run gets a fresh scope, so replays rebuild compensations instead of registering them again.
		const instance = WorkflowInstance.initial(
			activation.workflow,
			activation.identity.executionId,
			{ scope: Scope.forkUnsafe(activation.scope) },
		);
		activation.instance = instance;
		activation.fiber = yield* activation
			.execute(activation.payload, activation.identity.executionId)
			.pipe(
				Effect.onExit((exit) => {
					// Safe interrupts take effect only when the run would suspend; unsafe interrupts also
					// survive a replay that completes normally.
					if (
						!activation.interrupted ||
						(!activation.interruptedUnsafe &&
							!instance.suspended &&
							!instance.abandoned &&
							!(
								Context.get(instance.workflow.annotations, Workflow.SuspendOnFailure) &&
								Exit.isFailure(exit)
							))
					) {
						return Effect.void;
					}
					instance.interrupted = true;
					instance.suspended = false;
					return Effect.andThen(
						Effect.ignore(store.clearClocks(activation.identity)),
						Effect.withFiber((fiber) => Effect.interruptible(Fiber.interrupt(fiber))),
					);
				}),
				Workflow.intoResult,
				Effect.provideService(WorkflowEngine, engine),
				Effect.provideService(WorkflowAdmissionAccount, undefined),
				(effect) => deferredState.trackRun(instance, effect),
				Effect.tap((result) => settle(activation, result)),
				Effect.onExit((exit) => {
					if (Exit.isSuccess(exit) && exit.value._tag === "Suspended") {
						return Effect.void;
					}
					// The final run's scope closes with the real exit; closing the parent then closes the
					// superseded runs' scopes with `Exit.void`, so their compensations are skipped.
					return Scope.close(activation.scope, Exit.void);
				}),
				Effect.forkIn(entry.scope),
			);
	});

	// Loads an execution for a wake when this process owns it or can take it over.
	const acquire = Effect.fnUntraced(function* (
		identity: WorkflowIdentity,
	): Effect.fn.Return<undefined | Activation> {
		const loaded = activations.get(keyOf(identity));
		if (loaded) {
			return loaded;
		}
		if (!workflows.has(identity.workflowName) || !(yield* store.claim(identity, owner))) {
			return undefined;
		}
		const row = yield* store.find(identity);
		if (row?.status !== "active") {
			return undefined;
		}
		return yield* activate(row, yield* store.steps(identity));
	});

	const deferredDone = Effect.fnUntraced(function* (options: {
		readonly executionId: string;
		readonly workflowName: string;
		readonly deferredName: string;
		readonly exit: Exit.Exit<unknown, unknown>;
	}): Effect.fn.Return<void> {
		const identity = { executionId: options.executionId, workflowName: options.workflowName };
		const written = yield* store.writeStep({
			owner,
			identity,
			attempt: 0,
			kind: "deferred",
			name: options.deferredName,
			exit: yield* encodeExit(options.exit),
		});
		if (!written.admitted) {
			return yield* unadmitted;
		}
		if (written.rootExpired) {
			return yield* expired(identity);
		}
		if (!written.written) {
			return yield* Effect.void;
		}
		const interrupt = options.deferredName === InterruptSignal.name;
		const activation =
			activations.get(keyOf(identity)) ??
			(written.leaseLive && written.owner !== owner ? undefined : yield* acquire(identity));
		if (!activation) {
			return yield* Effect.void;
		}
		if (!activation.deferreds.has(options.deferredName)) {
			activation.deferreds.set(options.deferredName, options.exit);
		}
		activation.interrupted ||= interrupt;
		const current = yield* Effect.serviceOption(WorkflowInstance);
		if (Option.isSome(current) && current.value.executionId === options.executionId && !interrupt) {
			current.value.completedDeferreds.add(options.deferredName);
		}
		// A run that completes its own deferred reads it from the cache if it awaits it later.
		// Activities run with their own instance, so their completions still wake the run.
		const run = activation.instance;
		if (
			!interrupt &&
			activation.fiber?.pollUnsafe() === undefined &&
			run.completedDeferreds.has(options.deferredName) &&
			!run.awaitedDeferreds.has(options.deferredName)
		) {
			return yield* Effect.void;
		}
		const wake = Effect.andThen(
			deferredState.deferredDone(options.executionId, options.deferredName),
			resume(identity, interrupt ? "explicit" : "automatic"),
		);
		// A workflow finalizer cannot wait for its own run's cleanup; the engine scope owns the wake.
		return yield* Option.isSome(current) && current.value.executionId === options.executionId
			? wake.pipe(Effect.forkIn(scope), Effect.asVoid)
			: wake;
	});

	const run = Effect.fnUntraced(function* (
		workflow: Workflow.Any,
		options: ExecuteOptions<boolean>,
	): Effect.fn.Return<Result | undefined> {
		const entry = workflows.get(workflow._tag);
		if (!entry) {
			return yield* Effect.die(`Workflow ${workflow._tag} is not registered`);
		}
		const identity = { workflowName: workflow._tag, executionId: options.executionId };
		const account = yield* WorkflowAdmissionAccount;
		let activation = activations.get(keyOf(identity));
		if (!activation) {
			const parent = options.parent
				? { executionId: options.parent.executionId, workflowName: options.parent.workflow._tag }
				: undefined;
			const codecs = yield* codecsOf(workflow._tag);
			const payload = yield* codecs.encodePayload(options.payload).pipe(Effect.orDie);
			const admitted = yield* store.admit({ owner, parent, account, payload, identity });
			if (admitted.rejected) {
				return yield* rejected(
					account ? yield* retirement(account) : "Mutation command belongs to a retired account",
				);
			}
			let row = admitted.row;
			const parentRow = parent && !admitted.inserted ? yield* store.find(parent) : undefined;
			if (parent && !admitted.inserted && !parentRow) {
				return yield* Effect.die(new DbError({ message: "Workflow parent execution is missing" }));
			}
			if (!row || row.rootExpired) {
				return yield* expired(identity);
			}
			if (
				parentRow &&
				(row.rootWorkflowName !== parentRow.rootWorkflowName ||
					row.rootExecutionId !== parentRow.rootExecutionId)
			) {
				return yield* Effect.die(
					new DbError({ message: "Workflow execution belongs to another root" }),
				);
			}
			if (account && !admitted.inserted && !sameAccount(accountOf(row), account)) {
				if (accountOf(row) !== null || !(yield* store.adopt(identity, account))) {
					return yield* rejected("Workflow belongs to another account generation");
				}
				row = { ...row, accountToken: account.token, accountUserId: account.userId };
			}
			if (row.status !== "active") {
				if (options.discard) {
					return undefined;
				}
				return yield* codecs.decodeResult(row.result).pipe(Effect.orDie);
			}
			const owned = admitted.inserted || (yield* store.claim(identity, owner));
			if (!owned) {
				// Another live process runs it; callers wait through their retry schedule.
				return options.discard ? undefined : new Workflow.Suspended({});
			}
			const steps = admitted.inserted ? [] : yield* store.steps(identity);
			activation = yield* activate(
				options.detached || !parent
					? { ...row, parentExecutionId: null, parentWorkflowName: null }
					: row,
				steps,
			);
			if (!activation) {
				return yield* Effect.die(`Workflow ${workflow._tag} could not be activated`);
			}
			yield* resume(identity, "explicit");
		} else {
			if (account && !sameAccount(activation.account, account)) {
				if (activation.account !== null || !(yield* store.adopt(identity, account))) {
					return yield* rejected("Workflow belongs to another account generation");
				}
				activation.account = account;
			}
			if (!activation.fiber) {
				yield* resume(identity, "explicit");
			}
		}
		if (options.discard) {
			return undefined;
		}
		// Capture together so a wake that swaps in a replay cannot desync them.
		const instance = activation.instance;
		const fiber = activation.fiber;
		if (!fiber) {
			return new Workflow.Suspended({});
		}
		const exit = yield* Fiber.await(fiber);
		if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) && instance.suspended) {
			// A completion preempted the run; the caller retries into the replay.
			return new Workflow.Suspended({});
		}
		return yield* exit;
	});

	// The interface types the result by `discard`; the overload states that contract.
	function execute<const Discard extends boolean>(
		workflow: Workflow.Any,
		options: ExecuteOptions<Discard>,
	): Effect.Effect<Discard extends true ? void : Result>;
	function execute(
		workflow: Workflow.Any,
		options: ExecuteOptions<boolean>,
	): Effect.Effect<void | Result> {
		return run(workflow, options);
	}

	const engine: WorkflowEngine["Service"] = makeUnsafe({
		register: Effect.fnUntraced(function* (workflow, body) {
			workflows.set(workflow._tag, {
				workflow,
				execute: body,
				scope: yield* Effect.scope,
				codecs: Context.get(workflow.annotations, WorkflowCodecs),
			});
		}),

		execute,

		awaitComplete: (workflow, executionId) =>
			Effect.suspend(() => {
				const activation = activations.get(keyOf({ executionId, workflowName: workflow._tag }));
				return activation ? Effect.asVoid(Deferred.await(activation.done)) : Effect.never;
			}),

		poll: Effect.fnUntraced(function* (workflow, executionId) {
			const identity = { executionId, workflowName: workflow._tag };
			const activation = activations.get(keyOf(identity));
			const exit = activation?.fiber?.pollUnsafe();
			if (exit) {
				return exit._tag === "Success" ? Option.some(exit.value) : yield* Effect.die(exit.cause);
			}
			if (activation) {
				return Option.none();
			}
			const row = yield* store.find(identity);
			if (!row) {
				return Option.none();
			}
			if (row.status !== "active") {
				const codecs =
					workflows.get(workflow._tag)?.codecs ?? Context.get(workflow.annotations, WorkflowCodecs);
				if (!codecs) {
					return yield* Effect.die(`Workflow ${workflow._tag} has no result codec`);
				}
				return Option.some(yield* codecs.decodeResult(row.result).pipe(Effect.orDie));
			}
			return row.suspension === null
				? Option.none()
				: Option.some(new Workflow.Suspended(row.suspension === "failed" ? { failed: true } : {}));
		}),

		interrupt: Effect.fnUntraced(function* (workflow, executionId) {
			const row = yield* store.find({ executionId, workflowName: workflow._tag });
			if (row?.status !== "active") {
				return;
			}
			yield* deferredDone({
				executionId,
				exit: Exit.void,
				workflowName: workflow._tag,
				deferredName: InterruptSignal.name,
			});
		}),

		interruptUnsafe: Effect.fnUntraced(function* (workflow, executionId) {
			yield* engine.interrupt(workflow, executionId);
			const activation = activations.get(keyOf({ executionId, workflowName: workflow._tag }));
			if (!activation) {
				return;
			}
			activation.interruptedUnsafe = true;
			if (activation.fiber) {
				yield* Fiber.interrupt(activation.fiber);
			}
			// Replay after hard interruption to record a terminal workflow result.
			yield* resume(activation.identity, "explicit");
		}),

		resume: Effect.fnUntraced(function* (workflow, executionId) {
			const identity = { executionId, workflowName: workflow._tag };
			if (yield* acquire(identity)) {
				yield* resume(identity, "explicit");
			} else {
				yield* store.notify(identity);
			}
		}),

		activityExecute: Effect.fnUntraced(function* (activity, attempt) {
			const instance = yield* WorkflowInstance;
			const identity = { executionId: instance.executionId, workflowName: instance.workflow._tag };
			const activation = activations.get(keyOf(identity));
			const key = activityKey(activity.name, attempt);
			const stored = activation?.activities.get(key);
			if (stored) {
				return stored;
			}
			// A pending interrupt replays only to rebuild compensations, so it must not run new
			// activities. Finalizers run once `interrupted` is set.
			if (activation?.interrupted && !instance.interrupted) {
				return new Workflow.Suspended({});
			}
			const activityInstance = WorkflowInstance.initial(instance.workflow, instance.executionId, {
				awaitedDeferreds: instance.awaitedDeferreds,
			});
			activityInstance.interrupted = instance.interrupted;
			const result = yield* activity.executeEncoded.pipe(
				Workflow.intoResult,
				Effect.provideService(WorkflowInstance, activityInstance),
				Effect.provideService(Activity.CurrentAttempt, attempt),
				Effect.uninterruptible,
			);
			if (result._tag === "Suspended") {
				return result;
			}
			const written = yield* store.writeStep({
				owner,
				attempt,
				identity,
				kind: "activity",
				name: activity.name,
				exit: yield* encodeActivityResult(result),
			});
			if (written.rootExpired) {
				return yield* expired(identity);
			}
			if (!written.admitted) {
				return yield* unadmitted;
			}
			activation?.activities.set(key, result);
			return result;
		}),

		deferredResult: Effect.fnUntraced(function* (deferred) {
			const instance = yield* WorkflowInstance;
			const identity = { executionId: instance.executionId, workflowName: instance.workflow._tag };
			const activation = activations.get(keyOf(identity));
			if (activation) {
				return Option.fromNullishOr(activation.deferreds.get(deferred.name));
			}
			const row = (yield* store.steps(identity)).find(
				(step) => step.kind === "deferred" && step.name === deferred.name && step.exit !== null,
			);
			return row ? Option.some(yield* decodeExit(row.exit)) : Option.none();
		}),

		deferredDone,

		scheduleClock: Effect.fnUntraced(function* (workflow, options) {
			const identity = { workflowName: workflow._tag, executionId: options.executionId };
			const fireAt = DateTime.toDate(
				DateTime.addDuration(yield* DateTime.now, options.clock.duration),
			);
			const written = yield* store.writeStep({
				owner,
				fireAt,
				identity,
				attempt: 0,
				kind: "clock",
				exit: undefined,
				name: options.clock.name,
			});
			if (written.rootExpired) {
				return yield* expired(identity);
			}
			if (!written.admitted) {
				return yield* unadmitted;
			}
			return yield* written.written ? armClock(identity, options.clock.name, fireAt) : Effect.void;
		}),
	});

	// Wakes from other processes: a step or child result was written for an execution we own.
	const wakes = yield* pg.listen(workflowWakeChannel).pipe(Effect.orDie);
	yield* Stream.fromQueue(wakes).pipe(
		Stream.runForEach((notification) =>
			Effect.gen(function* () {
				const [workflowName, executionId] = yield* Schema.decodeEffect(WorkflowWake)(
					notification.payload,
				).pipe(Effect.orDie);
				const identity = { executionId, workflowName };
				const activation = activations.get(keyOf(identity)) ?? (yield* acquire(identity));
				if (!activation) {
					return;
				}
				const before = activation.interrupted;
				yield* loadSteps(activation, yield* store.steps(identity));
				yield* resume(identity, activation.interrupted && !before ? "explicit" : "automatic");
			}).pipe(Effect.catchCause((cause) => Effect.logWarning("workflow wake failed", cause))),
		),
		Effect.forkIn(scope),
	);

	yield* store.heartbeat(owner, leaseMs);
	yield* store.heartbeat(owner, leaseMs).pipe(
		Effect.delay(RENEW_EVERY),
		Effect.catchCause((cause) => Effect.logWarning("workflow lease renewal failed", cause)),
		Effect.forever,
		Effect.forkIn(scope),
	);

	// Takes over executions whose owner stopped renewing. Waiting executions replay and suspend
	// again unless a completion arrived meanwhile; failed suspensions wait for an explicit resume.
	yield* Effect.gen(function* () {
		// Only registered workflows are claimed: boot registers them after the engine starts.
		for (const identity of yield* store.claimOrphans(owner, [...workflows.keys()], SWEEP_LIMIT)) {
			const row = yield* store.find(identity);
			if (row?.status !== "active") {
				continue;
			}
			const activation = yield* activate(row, yield* store.steps(identity));
			if (activation && row.suspension !== "failed") {
				yield* resume(identity, row.suspension === null ? "explicit" : "automatic");
			}
		}
	}).pipe(
		Effect.catchCause((cause) => Effect.logWarning("workflow recovery sweep failed", cause)),
		Effect.repeat(Schedule.spaced(SWEEP_EVERY)),
		Effect.delay(Duration.seconds(1)),
		Effect.forkIn(scope),
	);

	yield* Effect.addFinalizer(() => store.release(owner).pipe(Effect.ignore));

	const accounts = WorkflowAccounts.of({
		listActive: store.listAccountExecutions,
		adopt: Effect.fnUntraced(function* (account) {
			const instance = yield* WorkflowInstance;
			const identity = { executionId: instance.executionId, workflowName: instance.workflow._tag };
			const activation = activations.get(keyOf(identity));
			if (account === null || !activation || sameAccount(activation.account, account)) {
				return yield* Effect.void;
			}
			if (activation.account !== null || !(yield* store.adopt(identity, account))) {
				return yield* new DbError({
					message:
						activation.account === null
							? yield* retirement(account)
							: "Workflow belongs to another account generation",
				});
			}
			activation.account = account;
			return yield* Effect.void;
		}),
	});

	return Context.make(WorkflowEngine, engine).pipe(Context.add(WorkflowAccounts, accounts));
});

export const PostgresWorkflowEngine = Layer.effectContext(makePostgresWorkflowEngine).pipe(
	Layer.provide(WorkflowEngineStore.layer),
);
