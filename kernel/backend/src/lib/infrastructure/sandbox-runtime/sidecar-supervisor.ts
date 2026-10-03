import type { TimeoutError } from "@ryot-app/contract/errors";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type { WorkflowReplayJournalEntry } from "@ryot-app/sandbox-sdk/workflow";
import { stableStringify } from "@ryot-app/ts-utils/json";
import {
	Cause,
	Clock,
	Context,
	Data,
	Deferred,
	Effect,
	Exit,
	Layer,
	Result,
	Scope,
	Semaphore,
} from "effect";

import {
	recordSandboxActiveExecutions,
	recordSandboxAdmission,
	recordSandboxSidecarEvent,
	recordSandboxSidecarGauges,
	recordSandboxSidecarHostCall,
} from "../runtime-metrics";
import { SandboxRecoveryStore, type SandboxRecoveryIdentity } from "../sandbox-recovery-store";
import { SandboxExecutionAuthority, type SandboxExecutionPrincipal } from "./execution-principal";
import type { SandboxHostCallGateRegistration } from "./host-call-gate";
import { SandboxSidecarAdmission, type SandboxAdmissionLease } from "./sidecar-admission";
import { SandboxSidecarClient } from "./sidecar-client";
import type { SidecarDoneFrame, SidecarRunFrame, SidecarTier } from "./sidecar-protocol";
import { SandboxSidecarQuarantine } from "./sidecar-quarantine";
import { selectSnapshotTier } from "./snapshot-tier";

type Connection = Effect.Success<ReturnType<SandboxSidecarClient["Service"]["connect"]>>;
type RunFrame = typeof SidecarRunFrame.Type;
type DoneFrame = typeof SidecarDoneFrame.Type;
type ProcessKey = {
	readonly instance: string;
	readonly trust: "system" | "user";
	readonly tier: typeof SidecarTier.Type;
};
type RunResult = {
	readonly done: DoneFrame;
	readonly inline: ReadonlyArray<WorkflowReplayJournalEntry>;
};

export class SidecarGenerationError extends Data.TaggedError("SidecarGenerationError")<{
	readonly instance: string;
	readonly generation: number;
	readonly culprit: string | undefined;
	readonly eventId: string;
	readonly reason: "transport" | "exit" | "backstop" | "shutdown";
}> {}

export class SidecarRecoverySuspended extends Data.TaggedError("SidecarRecoverySuspended")<{
	readonly instance: string;
}> {}

type LogicalRun = { handle: string | undefined; ticket: string | undefined; cancelled: boolean };
type RecoveryRound = {
	readonly candidates: LogicalRun[];
	readonly complete: Deferred.Deferred<void>;
	changed: Deferred.Deferred<void>;
};
type Protection = Effect.Success<ReturnType<SandboxSidecarQuarantine["Service"]["open"]>>;

type ActiveRun = {
	readonly logical: LogicalRun;
	readonly gate: SandboxHostCallGateRegistration;
	readonly scope: Scope.Scope;
	readonly result: Deferred.Deferred<RunResult, SidecarGenerationError>;
	readonly writes: Semaphore.Semaphore;
	pending: number;
	extendedMs: number;
	sent: boolean;
	completed: boolean;
	invalid: boolean;
	cancel: Effect.Effect<void>;
};

type Generation = {
	readonly connection: Connection;
	readonly scope: Scope.Closeable;
	readonly readyAt: number;
	readonly stopped: Deferred.Deferred<void>;
	readonly runs: Map<string, ActiveRun>;
	closing: boolean;
	draining: boolean;
	lastActiveAt: number;
};

type Instance = {
	readonly key: ProcessKey;
	readonly starts: Semaphore.Semaphore;
	current: Generation | undefined;
	failures: number;
	nextStartAt: number;
	waiting: number;
	startupFailed: boolean;
	recovery: RecoveryRound | undefined;
	healthyEpoch: string | undefined;
};

export type SandboxSidecarRun = {
	readonly executionId: string;
	readonly pinHash: string;
	readonly principal: SandboxExecutionPrincipal;
	readonly lease: SandboxAdmissionLease["Service"];
	readonly prepare: (identity: {
		readonly instance: string;
		readonly generation: number;
		readonly handle: string;
	}) => Effect.Effect<
		{
			readonly gate: SandboxHostCallGateRegistration;
			readonly input: RunFrame["input"];
			readonly module: RunFrame["module"];
			readonly finish: (done: DoneFrame) => Effect.Effect<void, SandboxRunError | TimeoutError>;
		},
		SandboxRunError,
		Scope.Scope
	>;
};

const startupError = () =>
	new SandboxRunError({ kind: "infrastructure", message: "Sandbox sidecar startup failed" });

const unavailableRecovery = () =>
	new SandboxRunError({
		kind: "resource-unavailable",
		message: "Sandbox recovery protection unavailable",
	});

export class SandboxSidecarSupervisor extends Context.Service<SandboxSidecarSupervisor>()(
	"SandboxSidecarSupervisor",
	{
		make: Effect.gen(function* () {
			const client = yield* SandboxSidecarClient;
			const admission = yield* SandboxSidecarAdmission;
			const authority = yield* SandboxExecutionAuthority;
			const quarantine = yield* SandboxSidecarQuarantine;
			const recoveryStore = yield* SandboxRecoveryStore;
			const protections = new WeakMap<
				SandboxAdmissionLease["Service"],
				{ readonly principal: string; readonly protection: Protection }
			>();
			const parent = yield* Effect.scope;
			const instances = new Map<string, Instance>();
			let nextGeneration = 0;
			let poisoned = false;
			let shuttingDown = false;
			const executions = { totalExecutions: 0, activeExecutions: 0, maxActiveExecutions: 0 };
			const locate = Effect.fn("SandboxSidecarSupervisor.locate")(function* (
				principal: SandboxExecutionPrincipal,
			) {
				const trust = yield* authority.resolve(principal);
				const tier = selectSnapshotTier(principal.metadata.runtimeImports);
				if (Result.isFailure(tier)) {
					return yield* new SandboxRunError({
						kind: "missing-artifact",
						message: "Sandbox runtime imports do not match a snapshot",
					});
				}
				return {
					trust,
					tier: tier.success,
					instance: `${trust}/${tier.success}`,
				} satisfies ProcessKey;
			});
			const getInstance = Effect.fnUntraced(function* (key: ProcessKey) {
				const existing = instances.get(key.instance);
				if (existing !== undefined) {
					return existing;
				}
				const entry: Instance = {
					key,
					waiting: 0,
					failures: 0,
					nextStartAt: 0,
					current: undefined,
					recovery: undefined,
					startupFailed: false,
					healthyEpoch: undefined,
					starts: yield* Semaphore.make(1),
				};
				instances.set(key.instance, entry);
				return entry;
			});
			const finishCandidate = (entry: Instance, logical: LogicalRun) => {
				const round = entry.recovery;
				if (round === undefined) {
					return;
				}
				const index = round.candidates.indexOf(logical);
				if (index < 0) {
					return;
				}
				round.candidates.splice(index, 1);
				const changed = round.changed;
				round.changed = Deferred.makeUnsafe<void>();
				if (round.candidates.length === 0) {
					entry.recovery = undefined;
					Deferred.doneUnsafe(round.complete, Effect.void);
				}
				Deferred.doneUnsafe(changed, Effect.void);
			};
			const closeGeneration = Effect.fnUntraced(function* (
				entry: Instance,
				generation: Generation,
				failure?: SidecarGenerationError,
			) {
				let terminalFailure = failure;
				if (generation.closing) {
					return yield* Deferred.await(generation.stopped);
				}
				generation.closing = true;
				const disposalAt = yield* Clock.currentTimeMillis;
				generation.draining = true;
				if (terminalFailure !== undefined && terminalFailure.reason !== "shutdown") {
					entry.healthyEpoch = undefined;
					const active = [...generation.runs.values()].filter(
						(run) => run.sent && !run.completed && !run.logical.cancelled,
					);
					if (
						terminalFailure.culprit === undefined &&
						entry.recovery !== undefined &&
						active.length === 1
					) {
						const candidate = active[0];
						if (candidate !== undefined && entry.recovery.candidates[0] === candidate.logical) {
							terminalFailure = new SidecarGenerationError({
								reason: terminalFailure.reason,
								eventId: terminalFailure.eventId,
								culprit: candidate.logical.handle,
								instance: terminalFailure.instance,
								generation: terminalFailure.generation,
							});
						}
					} else if (
						terminalFailure.culprit === undefined &&
						entry.recovery === undefined &&
						active.length > 0
					) {
						entry.recovery = {
							changed: Deferred.makeUnsafe<void>(),
							complete: Deferred.makeUnsafe<void>(),
							candidates: active
								.map((run) => run.logical)
								.sort((a, b) => ((a.ticket ?? "") < (b.ticket ?? "") ? -1 : 1)),
						};
					}
				}
				for (const run of generation.runs.values()) {
					yield* run.gate.close;
				}
				yield* generation.connection.close.pipe(
					Effect.tapError(() =>
						recordSandboxSidecarEvent({ ...entry.key, reason: "failed", event: "disposal" }).pipe(
							Effect.andThen(
								Effect.sync(() => {
									poisoned = true;
								}),
							),
						),
					),
					Effect.orDie,
				);
				yield* Scope.close(generation.scope, Exit.void);
				yield* recordSandboxSidecarEvent({
					...entry.key,
					event: "disposal",
					reason: "confirmed",
					durationMs: (yield* Clock.currentTimeMillis) - disposalAt,
				});
				yield* recordSandboxSidecarEvent({
					...entry.key,
					event: "released",
					reason: terminalFailure?.reason ?? "recycle",
				});
				if (entry.current === generation) {
					entry.current = undefined;
				}
				if (terminalFailure !== undefined) {
					const now = yield* Clock.currentTimeMillis;
					if (now - generation.readyAt >= 60_000) {
						entry.failures = 0;
					}
					entry.failures++;
					entry.nextStartAt = now + Math.min(30, 2 ** Math.min(5, entry.failures - 1)) * 1000;
					if (terminalFailure.reason !== "shutdown") {
						yield* recordSandboxSidecarEvent({
							...entry.key,
							event: "restart",
							reason: terminalFailure.reason,
							durationMs: entry.nextStartAt - now,
						});
					}
					for (const run of generation.runs.values()) {
						yield* Deferred.fail(run.result, terminalFailure);
					}
				}
				yield* Deferred.succeed(generation.stopped, undefined);
				return undefined;
			}, Effect.uninterruptible);
			const failureFor = (
				entry: Instance,
				generation: Generation,
				reason: SidecarGenerationError["reason"],
				culprit?: string,
			) =>
				new SidecarGenerationError({
					reason,
					culprit,
					eventId: crypto.randomUUID(),
					instance: entry.key.instance,
					generation: generation.connection.generation,
				});
			const scheduleClose = (
				entry: Instance,
				generation: Generation,
				failure?: SidecarGenerationError,
			) =>
				closeGeneration(entry, generation, failure).pipe(
					Effect.andThen(() =>
						!shuttingDown && entry.key.tier === "core"
							? ensure(entry).pipe(
									Effect.asVoid,
									Effect.catch(() =>
										Effect.logError("Resident sandbox sidecar replacement failed"),
									),
								)
							: Effect.void,
					),
					Effect.forkIn(parent),
					Effect.asVoid,
				);
			const receive = Effect.fnUntraced(function* (entry: Instance, generation: Generation) {
				while (!generation.closing) {
					const frame = yield* generation.connection.next;
					if (frame.type === "draining") {
						yield* recordSandboxSidecarEvent({
							...entry.key,
							event: "limit",
							reason: frame.reason,
						});
						generation.draining = true;
						if (generation.runs.size === 0) {
							yield* scheduleClose(entry, generation);
						}
						continue;
					}
					if (frame.type === "fatal") {
						yield* scheduleClose(
							entry,
							generation,
							failureFor(
								entry,
								generation,
								"exit",
								generation.runs.has(frame.handle) ? frame.handle : undefined,
							),
						);
						return undefined;
					}
					if (frame.type === "ready" || frame.type === "part") {
						yield* scheduleClose(entry, generation, failureFor(entry, generation, "transport"));
						return undefined;
					}
					const run = generation.runs.get(frame.handle);
					if (run === undefined || (yield* Deferred.isDone(run.result))) {
						continue;
					}
					if (frame.type === "invalid") {
						run.invalid = true;
						yield* run.cancel.pipe(Effect.forkIn(run.scope));
						continue;
					}
					if (frame.type === "done") {
						if (frame.outcome.status === "limit") {
							yield* recordSandboxSidecarEvent({
								...entry.key,
								event: "limit",
								reason: frame.outcome.limit,
							});
						}
						run.completed = true;
						yield* generation.connection.retire(frame.handle);
						yield* Deferred.succeed(run.result, { done: frame, inline: run.gate.inlineEntries() });
						continue;
					}
					if (run.pending >= 8) {
						yield* recordSandboxSidecarHostCall({
							...entry.key,
							outcome: "failure",
							function: frame.name,
						});
						yield* generation.connection.send({
							seq: frame.seq,
							type: "hostResult",
							handle: frame.handle,
							generation: frame.generation,
							result: { status: "failure", message: "Sandbox host call queue is full" },
						});
						continue;
					}
					run.pending++;
					yield* admission.withDatabaseLimit(run.gate.dispatch(frame)).pipe(
						Effect.onExit((exit) => {
							const result = Exit.isSuccess(exit) ? exit.value.result : undefined;
							const failed =
								result?.status === "failure" ||
								(result?.status === "success" &&
									typeof result.value === "object" &&
									result.value !== null &&
									"success" in result.value &&
									result.value["success"] === false);
							let outcome: "interrupted" | "failure" | "success";
							if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) {
								outcome = "interrupted";
							} else if (Exit.isFailure(exit) || failed) {
								outcome = "failure";
							} else {
								outcome = "success";
							}
							return recordSandboxSidecarHostCall({ ...entry.key, outcome, function: frame.name });
						}),
						Effect.flatMap((reply) =>
							run.writes.withPermits(1)(
								Effect.gen(function* () {
									const budget = yield* run.gate.scriptBudget;
									const elapsed = budget.settledMs - run.extendedMs;
									if (elapsed > 0) {
										yield* run.gate.extend(elapsed);
										run.extendedMs = budget.settledMs;
									}
									if (!generation.closing && !(yield* Deferred.isDone(run.result))) {
										yield* generation.connection.send(reply);
									}
								}),
							),
						),
						Effect.catchCauseIf(
							(cause) => !Cause.hasInterrupts(cause),
							() =>
								generation.closing
									? Effect.void
									: scheduleClose(entry, generation, failureFor(entry, generation, "transport")),
						),
						Effect.ensuring(
							Effect.sync(() => {
								run.pending--;
							}),
						),
						Effect.forkIn(run.scope),
					);
				}
				return undefined;
			});
			const ensure = Effect.fnUntraced(function* (
				entry: Instance,
				lease?: SandboxAdmissionLease["Service"],
			): Effect.fn.Return<Generation, SandboxRunError> {
				return yield* entry.starts.withPermits(1)(
					Effect.gen(function* () {
						if (shuttingDown || poisoned || entry.startupFailed) {
							return yield* startupError();
						}
						const previous = entry.current;
						if (previous !== undefined && !previous.closing && !previous.draining) {
							return previous;
						}
						if (previous !== undefined) {
							if (previous.runs.size > 0 || previous.closing) {
								yield* Deferred.await(previous.stopped);
							} else {
								yield* closeGeneration(entry, previous);
							}
						}
						const now = yield* Clock.currentTimeMillis;
						if (entry.nextStartAt > now) {
							yield* Effect.sleep(entry.nextStartAt - now);
						}
						if (nextGeneration >= 4_294_967_295) {
							return yield* startupError();
						}
						const generationId = ++nextGeneration;
						const scope = yield* Scope.fork(parent);
						const started = yield* Effect.uninterruptibleMask((restore) =>
							Effect.gen(function* () {
								const attempt = yield* Effect.exit(
									restore(
										Effect.gen(function* () {
											yield* admission.reserveProcess(entry.key.instance, generationId, lease);
											const connection = yield* client.connect({
												tier: entry.key.tier,
												trust: entry.key.trust,
												generation: generationId,
												threads: admission.maximumActive,
												memoryBudget: admission.isolateMemoryBytes,
												maxActive: Math.min(admission.maximumActive, navigator.hardwareConcurrency),
												maxRss: Math.min(
													1536 * 1024 * 1024,
													128 * 1024 * 1024 + admission.isolateMemoryBytes,
												),
											});
											const ready = yield* connection.next.pipe(Effect.timeout("10 seconds"));
											if (ready.type !== "ready" || ready.generation !== generationId) {
												return yield* startupError();
											}
											const readyAt = yield* Clock.currentTimeMillis;
											const generation: Generation = {
												scope,
												readyAt,
												connection,
												closing: false,
												draining: false,
												lastActiveAt: readyAt,
												runs: new Map<string, ActiveRun>(),
												stopped: yield* Deferred.make<void>(),
											};
											return generation;
										}).pipe(Scope.provide(scope)),
									),
								);
								if (Exit.isFailure(attempt)) {
									yield* Scope.close(scope, Exit.void);
									if (!Cause.hasInterrupts(attempt.cause)) {
										entry.startupFailed = true;
									}
								}
								return attempt;
							}),
						);
						if (Exit.isFailure(started)) {
							return yield* Effect.failCause(Cause.map(started.cause, startupError));
						}
						const generation = started.value;
						entry.current = generation;
						yield* recordSandboxSidecarEvent({ ...entry.key, event: "ready", reason: "ready" });
						yield* receive(entry, generation).pipe(
							Effect.catch(() =>
								scheduleClose(
									entry,
									generation,
									generation.draining && generation.runs.size === 0
										? undefined
										: failureFor(entry, generation, "transport"),
								),
							),
							Effect.forkIn(scope),
						);
						{
							yield* Effect.gen(function* () {
								while (!generation.closing) {
									yield* Effect.sleep("1 second");
									const clockNow = yield* Clock.currentTimeMillis;
									const generationIsClosing = yield* Effect.sync(() => generation.closing);
									if (
										!generationIsClosing &&
										clockNow - generation.readyAt >= 60_000 &&
										entry.healthyEpoch === undefined
									) {
										entry.healthyEpoch = crypto.randomUUID();
									}
									if (
										entry.key.tier !== "core" &&
										entry.recovery === undefined &&
										generation.runs.size === 0 &&
										entry.waiting === 0 &&
										(yield* Clock.currentTimeMillis) - generation.lastActiveAt >= 60_000
									) {
										yield* scheduleClose(entry, generation);
										return;
									}
								}
							}).pipe(Effect.forkIn(scope));
						}
						return generation;
					}),
				);
			});
			const attempt = Effect.fn("SandboxSidecarSupervisor.attempt")(function* (
				options: SandboxSidecarRun,
				key: ProcessKey,
				entry: Instance,
				logical: LogicalRun,
			) {
				entry.waiting++;
				return yield* Effect.scoped(
					Effect.gen(function* () {
						const scope = yield* Effect.scope;
						const generation = yield* ensure(entry, options.lease);
						yield* options.lease.enter({
							lane: "interactive",
							instance: key.instance,
							generation: generation.connection.generation,
						});
						const handle = crypto.randomUUID().replaceAll("-", "");
						logical.handle = handle;
						logical.ticket ??= handle;
						const prepared = yield* options.prepare({
							handle,
							instance: key.instance,
							generation: generation.connection.generation,
						});
						const active: ActiveRun = {
							scope,
							logical,
							pending: 0,
							sent: false,
							extendedMs: 0,
							invalid: false,
							completed: false,
							cancel: Effect.void,
							gate: prepared.gate,
							writes: yield* Semaphore.make(1),
							result: yield* Deferred.make<RunResult, SidecarGenerationError>(),
						};
						const cancel = Effect.gen(function* () {
							if (!active.sent || (yield* Deferred.isDone(active.result))) {
								return undefined;
							}
							if (!generation.closing) {
								yield* generation.connection
									.send({
										handle,
										seq: 0,
										type: "cancel",
										generation: generation.connection.generation,
									})
									.pipe(Effect.ignore);
							}
							const disposed = yield* Deferred.await(active.result).pipe(
								Effect.as(true),
								Effect.orElseSucceed(() => true),
								Effect.timeoutOrElse({
									duration: "2 seconds",
									orElse: () => Effect.succeed(false),
								}),
							);
							if (!disposed) {
								yield* closeGeneration(
									entry,
									generation,
									failureFor(entry, generation, "backstop"),
								);
							}
							return undefined;
						});
						active.cancel = cancel;
						yield* Effect.addFinalizer(() =>
							cancel.pipe(
								Effect.andThen(
									Effect.gen(function* () {
										yield* prepared.gate.close;
										yield* generation.connection.retire(handle);
										generation.runs.delete(handle);
										generation.lastActiveAt = yield* Clock.currentTimeMillis;
										if (generation.draining && generation.runs.size === 0 && !generation.closing) {
											yield* scheduleClose(entry, generation);
										}
									}),
								),
								Effect.ensuring(
									Effect.sync(() => {
										if (active.sent) {
											executions.activeExecutions--;
										}
									}),
								),
							),
						);
						yield* Effect.uninterruptible(
							Effect.gen(function* () {
								if (generation.closing || generation.draining || entry.current !== generation) {
									return yield* startupError();
								}
								yield* generation.connection.register(handle).pipe(Effect.mapError(startupError));
								generation.runs.set(handle, active);
								const budget = yield* prepared.gate.scriptBudget;
								active.sent = true;
								executions.totalExecutions++;
								executions.activeExecutions++;
								executions.maxActiveExecutions = Math.max(
									executions.maxActiveExecutions,
									executions.activeExecutions,
								);
								yield* generation.connection
									.send({
										handle,
										seq: 0,
										type: "run",
										tier: key.tier,
										lane: "interactive",
										input: prepared.input,
										module: prepared.module,
										generation: generation.connection.generation,
										limits: {
											cpuMs: 30_000,
											heapBytes: 256 * 1024 * 1024,
											externalBytes: 64 * 1024 * 1024,
											deadlineMs: Math.max(1, Math.ceil(budget.remainingMs)),
										},
									})
									.pipe(
										Effect.catch(() =>
											closeGeneration(
												entry,
												generation,
												failureFor(entry, generation, "transport"),
											),
										),
									);
								return undefined;
							}),
						);
						const startedAt = yield* Clock.currentTimeMillis;
						yield* Effect.gen(function* () {
							while (!(yield* Deferred.isDone(active.result))) {
								const budget = yield* prepared.gate.scriptBudget;
								const absolute = 300_000 - ((yield* Clock.currentTimeMillis) - startedAt);
								if (budget.remainingMs <= 0 || absolute <= 0) {
									return yield* cancel;
								}
								yield* Effect.sleep(Math.min(1000, budget.remainingMs, absolute));
							}
							return undefined;
						}).pipe(Effect.forkScoped);
						const result = yield* Deferred.await(active.result).pipe(
							Effect.onInterrupt(() =>
								Effect.sync(() => {
									logical.cancelled = true;
								}),
							),
						);
						if (active.invalid) {
							return yield* new SandboxRunError({
								kind: "infrastructure",
								message: "Sandbox sidecar returned an invalid execution payload",
							});
						}
						yield* prepared.gate.close;
						yield* prepared.finish(result.done);
						return result;
					}),
				).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							entry.waiting--;
						}),
					),
				);
			});
			const reserve = Effect.fn("SandboxSidecarSupervisor.reserve")(function* (
				principal: SandboxExecutionPrincipal,
				journal: boolean,
			) {
				const key = yield* locate(principal);
				const protection = yield* quarantine
					.open(principal, key.trust)
					.pipe(
						Effect.tapError(() =>
							recordSandboxSidecarEvent({ ...key, reason: "rejected", event: "quarantine" }),
						),
					);
				if (protection.probation) {
					yield* recordSandboxSidecarEvent({ ...key, reason: "opened", event: "probation" });
				}
				const reservation = admission.reservePrefix({ journal, instance: key.instance });
				const lease = yield* protection.probation
					? reservation.pipe(
							Effect.timeoutOrElse({
								duration: "20 seconds",
								orElse: () =>
									Effect.fail(
										new SandboxRunError({
											kind: "resource-unavailable",
											message: "Sandbox probation could not obtain admission",
										}),
									),
							}),
						)
					: reservation;
				protections.set(lease, { protection, principal: stableStringify(principal) });
				return lease;
			});

			const run = Effect.fn("SandboxSidecarSupervisor.run")(function* (options: SandboxSidecarRun) {
				const key = yield* locate(options.principal);
				const entry = yield* getInstance(key);
				const protectedLease = protections.get(options.lease);
				if (
					protectedLease === undefined ||
					protectedLease.principal !== stableStringify(options.principal)
				) {
					return yield* new SandboxRunError({
						kind: "invalid-input",
						message: "Sandbox admission does not match its principal",
					});
				}
				const logical: LogicalRun = { cancelled: false, handle: undefined, ticket: undefined };
				return yield* Effect.scoped(
					Effect.gen(function* () {
						yield* Effect.addFinalizer(() => Effect.sync(() => finishCandidate(entry, logical)));
						let state = yield* recoveryStore
							.read(options.executionId, key.instance, options.pinHash)
							.pipe(Effect.mapError(unavailableRecovery));
						if (state.suspended) {
							if (entry.healthyEpoch === undefined) {
								yield* ensure(entry, options.lease);
								return yield* new SidecarRecoverySuspended({ instance: key.instance });
							}
							state = yield* recoveryStore
								.resume(options.executionId, key.instance, options.pinHash, entry.healthyEpoch)
								.pipe(Effect.mapError(unavailableRecovery));
							if (state.suspended) {
								return yield* new SidecarRecoverySuspended({ instance: key.instance });
							}
						}
						for (;;) {
							while (entry.recovery !== undefined && entry.recovery.candidates[0] !== logical) {
								const round = entry.recovery;
								yield* Deferred.await(
									round.candidates.includes(logical) ? round.changed : round.complete,
								);
							}
							const probing = entry.recovery?.candidates[0] === logical;
							const result = yield* Effect.result(attempt(options, key, entry, logical));
							if (probing) {
								yield* recordSandboxSidecarEvent({
									...key,
									event: "probe",
									reason: Result.isSuccess(result) ? "survived" : "failed",
								});
							}
							if (Result.isSuccess(result)) {
								if (result.success.done.outcome.status === "completed") {
									entry.healthyEpoch = crypto.randomUUID();
								}
								yield* protectedLease.protection.survived;
								return {
									...result.success,
									recovery: {
										instance: key.instance,
										pinHash: options.pinHash,
										executionId: options.executionId,
									},
								};
							}
							const failure = result.failure;
							if (!(failure instanceof SidecarGenerationError)) {
								return yield* failure;
							}
							if (failure.reason === "shutdown") {
								return yield* startupError();
							}
							if (failure.culprit !== undefined && failure.culprit === logical.handle) {
								yield* protectedLease.protection.recordCrash;
								return yield* new SandboxRunError({
									kind: "script-failure",
									message: "Sandbox execution caused a native sidecar failure",
								});
							}
							state = yield* recoveryStore
								.collateral(options.executionId, key.instance, options.pinHash, failure.eventId)
								.pipe(Effect.mapError(unavailableRecovery));
							yield* recordSandboxSidecarEvent({
								...key,
								event: "collateral",
								reason: state.suspended ? "suspended" : "retry",
							});
							if (state.suspended) {
								return yield* new SidecarRecoverySuspended({ instance: key.instance });
							}
						}
					}),
				);
			});
			for (const trust of ["system", "user"] as const) {
				const entry = yield* getInstance({ trust, tier: "core", instance: `${trust}/core` });
				yield* ensure(entry);
			}
			yield* Effect.addFinalizer(() =>
				Effect.gen(function* () {
					shuttingDown = true;
					for (const entry of instances.values()) {
						if (entry.current !== undefined) {
							yield* closeGeneration(
								entry,
								entry.current,
								failureFor(entry, entry.current, "shutdown"),
							);
						}
					}
				}),
			);
			const completeRecovery = Effect.fn("SandboxSidecarSupervisor.completeRecovery")(function* (
				identity: typeof SandboxRecoveryIdentity.Type,
			) {
				yield* recoveryStore
					.clear(identity.executionId, identity.instance, identity.pinHash)
					.pipe(Effect.mapError(unavailableRecovery));
			});
			const sample = Effect.gen(function* () {
				yield* recordSandboxActiveExecutions(executions.activeExecutions);
				yield* recordSandboxAdmission(admission.snapshot());
				const now = yield* Clock.currentTimeMillis;
				for (const entry of instances.values()) {
					const generation = entry.current;
					yield* recordSandboxSidecarGauges({
						...entry.key,
						runs: generation?.runs.size ?? 0,
						backoffMs: Math.max(0, entry.nextStartAt - now),
						hostCalls: [...(generation?.runs.values() ?? [])].reduce(
							(sum, activeRun) => sum + activeRun.pending,
							0,
						),
					});
				}
			});
			yield* Effect.gen(function* () {
				for (;;) {
					yield* sample;
					yield* Effect.sleep("1 second");
				}
			}).pipe(Effect.forkIn(parent));
			return { run, locate, reserve, completeRecovery, snapshot: () => ({ ...executions }) };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(SandboxSidecarClient.layer),
		Layer.provideMerge(SandboxSidecarAdmission.layer),
		Layer.provide(SandboxSidecarQuarantine.layer),
		Layer.provide(SandboxRecoveryStore.layer),
	);
}
