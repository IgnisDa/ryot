import { expect, it, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { Deferred, Effect, Exit, Fiber, Layer, Option, Result, Schema, Scope } from "effect";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { SANDBOX_TRANSIENT_MEMORY } from "./host-call-gate";
import { MiB, SANDBOX_LIMITS } from "./limits";
import { SandboxSidecarAdmission, sandboxMemoryBudgetBytes } from "./sidecar-admission";
import { readWorkflowJournal } from "./workflow-journal";

const admissionLayer = Layer.effect(SandboxSidecarAdmission, SandboxSidecarAdmission.make).pipe(
	Layer.provide(makeAppConfigLayer({ sandbox: { memoryBudgetMiB: Option.some(1300) } })),
);
const idleBytes = 2 * 128 * MiB + SANDBOX_TRANSIENT_MEMORY.poolBytes;
const acquireScope = Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

layer(admissionLayer)((test) => {
	test.effect("journal_read_cancellation_retains_memory_until_the_native_reply_finishes", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const admission = yield* SandboxSidecarAdmission;
				const started = yield* Deferred.make<void>();
				const pending = Promise.withResolvers<unknown>();
				const raw = encodeJson({
					value: "done",
					request: {
						index: 0,
						name: "call",
						kind: "activity",
						args: { input: null, scriptSlug: "activity" },
					},
				});
				const bytes = utf8ByteLength(raw);
				const reader = yield* Effect.scoped(
					Effect.gen(function* () {
						yield* admission.reservePrefix({ journalBytes: bytes + 2, instance: "system/core" });
						yield* readWorkflowJournal(
							{
								client: {
									eval: () => {
										Deferred.doneUnsafe(started, Effect.void);
										return pending.promise;
									},
								},
							},
							"cancelled-journal-read",
							{ bytes: bytes + 2, entries: [[bytes, "0".repeat(40)]] },
						);
					}),
				).pipe(Effect.forkScoped({ startImmediately: true }));
				yield* Deferred.await(started);
				const reserved = admission.snapshot().bytes;
				const cancelling = yield* Fiber.interrupt(reader).pipe(
					Effect.forkScoped({ startImmediately: true }),
				);
				expect(admission.snapshot()).toMatchObject({ reservations: 1, bytes: reserved });
				pending.resolve(["read", [raw]]);
				yield* Fiber.join(cancelling);
				expect(admission.snapshot()).toMatchObject({ reservations: 0, bytes: idleBytes });
			}),
		),
	);

	test.effect("atomic_admission_keeps_memory_waiters_from_holding_execution_slots", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const admission = yield* SandboxSidecarAdmission;
				const firstScope = yield* acquireScope;
				const smallScope = yield* acquireScope;
				yield* admission
					.reservePrefix({ journalBytes: 2, instance: "system/core" })
					.pipe(Scope.provide(firstScope));
				const firstBytes = admission.snapshot().bytes;
				const largeEntered = yield* Deferred.make<void>();
				const large = yield* Effect.scoped(
					admission
						.reservePrefix({ instance: "system/core", journalBytes: SANDBOX_LIMITS.journalBytes })
						.pipe(Effect.tap(() => Deferred.succeed(largeEntered, undefined))),
				).pipe(Effect.forkScoped({ startImmediately: true }));
				expect(admission.snapshot()).toMatchObject({
					waiting: 1,
					reservations: 1,
					bytes: firstBytes,
				});

				yield* admission
					.reservePrefix({ journalBytes: 2, instance: "system/core" })
					.pipe(Scope.provide(smallScope));
				expect(admission.snapshot()).toMatchObject({ waiting: 1, reservations: 2 });
				expect(admission.snapshot().bytes).toBeLessThanOrEqual(admission.snapshot().budget);
				expect(yield* Deferred.isDone(largeEntered)).toBe(false);
				yield* Fiber.interrupt(large);
				expect(admission.snapshot()).toMatchObject({ waiting: 0, reservations: 2 });
				yield* Scope.close(firstScope, Exit.void);
				yield* Scope.close(smallScope, Exit.void);
				expect(admission.snapshot()).toMatchObject({ reservations: 0, bytes: idleBytes });
			}),
		),
	);

	test.effect(
		"inspected_small_journals_can_reserve_two_replays_without_maximum_prefix_allowances",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const admission = yield* SandboxSidecarAdmission;
					const firstScope = yield* acquireScope;
					const secondScope = yield* acquireScope;
					const processScope = yield* acquireScope;
					const first = yield* admission
						.reservePrefix({ journalBytes: 1024, instance: "system/core" })
						.pipe(Scope.provide(firstScope));
					const second = yield* admission
						.reservePrefix({ journalBytes: 1024, instance: "system/core" })
						.pipe(Scope.provide(secondScope));
					yield* admission
						.reserveProcess("system/core", 1, first)
						.pipe(Scope.provide(processScope));
					yield* first.enter({ generation: 1, lane: "interactive", instance: "system/core" });
					yield* second.enter({ generation: 1, lane: "interactive", instance: "system/core" });
					expect(admission.snapshot()).toMatchObject({ runs: 2, waiting: 0, reservations: 2 });
					expect(admission.snapshot().bytes).toBeLessThanOrEqual(admission.snapshot().budget);
					const growth = yield* Effect.flip(second.retainJournal(1025));
					expect(growth.message).toBe("Sandbox journal reservation cannot grow after loading");
				}),
			),
	);

	test.effect(
		"large journal waiters cannot consume the bytes needed for the admitted replay to start",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const firstScope = yield* acquireScope;
					const processScope = yield* acquireScope;
					const admission = yield* SandboxSidecarAdmission;
					const first = yield* admission
						.reservePrefix({ instance: "user/full", journalBytes: SANDBOX_LIMITS.journalBytes })
						.pipe(Scope.provide(firstScope));
					const secondEntered = yield* Deferred.make<void>();
					const releaseSecond = yield* Deferred.make<void>();
					const second = yield* Effect.scoped(
						Effect.gen(function* () {
							const lease = yield* admission.reservePrefix({
								instance: "user/full",
								journalBytes: SANDBOX_LIMITS.journalBytes,
							});
							yield* lease.retainJournal(SANDBOX_LIMITS.journalBytes);
							yield* lease.enter({ generation: 1, lane: "interactive", instance: "user/full" });
							yield* Deferred.succeed(secondEntered, undefined);
							yield* Deferred.await(releaseSecond);
						}),
					).pipe(Effect.forkScoped({ startImmediately: true }));
					expect(yield* Deferred.isDone(secondEntered)).toBe(false);
					yield* first.retainJournal(SANDBOX_LIMITS.journalBytes);
					yield* admission.reserveProcess("user/full", 1, first).pipe(Scope.provide(processScope));
					yield* first.enter({ generation: 1, lane: "interactive", instance: "user/full" });
					expect(admission.snapshot().runs).toBe(1);
					yield* Scope.close(firstScope, Exit.void);
					yield* Deferred.await(secondEntered);
					expect(admission.snapshot().runs).toBe(1);
					expect(admission.snapshot().bytes).toBeLessThanOrEqual(admission.snapshot().budget);
					yield* Deferred.succeed(releaseSecond, undefined);
					yield* Fiber.join(second);
					expect(admission.snapshot().runs).toBe(0);
					yield* Scope.close(processScope, Exit.void);
					expect(admission.snapshot().bytes).toBe(idleBytes);
				}),
			),
	);
	test.effect(
		"reserves the journal before loading and atomically reserves a lazy process with its first run",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const admission = yield* SandboxSidecarAdmission;
					const prefixScope = yield* acquireScope;
					const processScope = yield* acquireScope;
					const lease = yield* admission
						.reservePrefix({ instance: "user/full", journalBytes: SANDBOX_LIMITS.journalBytes })
						.pipe(Scope.provide(prefixScope));
					const journalReservationBytes = admission.snapshot().bytes;
					expect(journalReservationBytes).toBeGreaterThan(300 * 1024 * 1024);
					yield* lease.retainJournal(1024);
					expect(admission.snapshot().bytes).toBe(
						journalReservationBytes - (300 * 1024 * 1024 - 3072),
					);
					yield* admission.reserveProcess("user/full", 1, lease).pipe(Scope.provide(processScope));
					const reserved = admission.snapshot();
					expect(reserved.processes).toBe(1);
					expect(reserved.bytes).toBeGreaterThan(128 * 1024 * 1024);
					yield* lease.enter({ generation: 1, lane: "interactive", instance: "user/full" });
					expect(admission.snapshot().bytes).toBe(reserved.bytes);
					expect(admission.snapshot().runs).toBe(1);
					yield* Scope.close(prefixScope, Exit.void);
					expect(admission.snapshot().runs).toBe(0);
					expect(admission.snapshot().bytes).toBe(idleBytes + 128 * MiB);
					yield* Scope.close(processScope, Exit.void);
					expect(admission.snapshot().bytes).toBe(idleBytes);
				}),
			),
	);
	test.effect(
		"bounds global waiters and refunds an interrupted waiter without consuming a slot",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const admission = yield* SandboxSidecarAdmission;
					const first = yield* acquireScope;
					const second = yield* acquireScope;
					yield* admission
						.reservePrefix({ journalBytes: 2, instance: "system/core" })
						.pipe(Scope.provide(first));
					const singleLeaseBytes = admission.snapshot().bytes;
					yield* admission
						.reservePrefix({ journalBytes: 2, instance: "system/core" })
						.pipe(Scope.provide(second));
					const entered = yield* Deferred.make<void>();
					const waiter = yield* Effect.scoped(
						admission
							.reservePrefix({ journalBytes: 2, instance: "system/core" })
							.pipe(Effect.tap(() => Deferred.succeed(entered, undefined))),
					).pipe(Effect.forkScoped);
					yield* Effect.yieldNow;
					expect(admission.snapshot().waiting).toBe(1);
					expect(yield* Deferred.isDone(entered)).toBe(false);
					const secondWaiter = yield* Effect.scoped(
						admission.reservePrefix({ journalBytes: 2, instance: "system/core" }),
					).pipe(Effect.forkScoped);
					yield* Effect.yieldNow;
					expect(admission.snapshot().waiting).toBe(2);
					const full = yield* Effect.flip(
						admission.reservePrefix({ journalBytes: 2, instance: "system/core" }),
					);
					expect(full.message).toBe("Sandbox ephemeral admission queue is full");
					yield* Fiber.interrupt(secondWaiter);
					yield* Fiber.interrupt(waiter);
					expect(admission.snapshot().waiting).toBe(0);
					yield* Scope.close(first, Exit.void);
					yield* Effect.scoped(
						admission.reservePrefix({ journalBytes: 2, instance: "system/core" }),
					);
					expect(admission.snapshot().bytes).toBe(singleLeaseBytes);
				}),
			),
	);
	test.effect(
		"rejects duplicate starts, foreign generations and closed leases without counter underflow",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const admission = yield* SandboxSidecarAdmission;
					const prefixScope = yield* acquireScope;
					const processScope = yield* acquireScope;
					const lease = yield* admission
						.reservePrefix({ journalBytes: 2, instance: "system/core" })
						.pipe(Scope.provide(prefixScope));
					yield* admission.reserveProcess("system/core", 4).pipe(Scope.provide(processScope));
					const duplicate = yield* Effect.flip(admission.reserveProcess("system/core", 5));
					expect(duplicate).toBeInstanceOf(SandboxRunError);
					const foreign = yield* Effect.flip(
						lease.enter({ generation: 3, lane: "background", instance: "system/core" }),
					);
					expect(foreign.kind).toBe("resource-unavailable");
					expect(admission.snapshot().runs).toBe(0);
					yield* lease.enter({ generation: 4, lane: "background", instance: "system/core" });
					const repeated = yield* Effect.flip(
						lease.enter({ generation: 4, lane: "background", instance: "system/core" }),
					);
					expect(repeated).toBeInstanceOf(SandboxRunError);
					yield* Scope.close(prefixScope, Exit.void);
					const closed = yield* Effect.flip(
						lease.enter({ generation: 4, lane: "background", instance: "system/core" }),
					);
					expect(closed).toBeInstanceOf(SandboxRunError);
					yield* Scope.close(processScope, Exit.void);
					expect(admission.snapshot().bytes).toBe(idleBytes);
					expect(admission.snapshot().runs).toBe(0);
				}),
			),
	);
	test.effect("memory_admission_counts_journals_frames_startups_and_buffers", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const measured = yield* SandboxSidecarAdmission;
				const idle = measured.snapshot().bytes;
				expect(idle).toBe(idleBytes);
				const measureScope = yield* acquireScope;
				yield* measured
					.reservePrefix({ journalBytes: 2, instance: "system/core" })
					.pipe(Scope.provide(measureScope));
				const runBytes = measured.snapshot().bytes - idle;
				expect(runBytes).toBe(298 * MiB + 3 * "[]".length);
				yield* Scope.close(measureScope, Exit.void);

				const journalScope = yield* acquireScope;
				const journal = yield* measured
					.reservePrefix({ instance: "system/core", journalBytes: SANDBOX_LIMITS.journalBytes })
					.pipe(Scope.provide(journalScope));
				expect(measured.snapshot().bytes - idle).toBe(
					runBytes + 3 * (SANDBOX_LIMITS.journalBytes - "[]".length),
				);
				yield* journal.retainJournal(1000);
				expect(measured.snapshot().bytes - idle).toBe(runBytes + 3 * (1000 - "[]".length));
				const grown = yield* Effect.flip(journal.retainJournal(2000));
				expect(grown.kind).toBe("resource-unavailable");
				yield* Scope.close(journalScope, Exit.void);
				expect(measured.snapshot().bytes).toBe(idle);

				const tightConfig = yield* Layer.build(
					makeAppConfigLayer({
						sandbox: {
							memoryBudgetMiB: Option.some(Math.ceil((idle + 128 * MiB + runBytes) / MiB)),
						},
					}),
				);
				const tight = yield* SandboxSidecarAdmission.make.pipe(Effect.provideContext(tightConfig));
				const leaseScope = yield* acquireScope;
				const processScope = yield* acquireScope;
				const lazy = yield* tight
					.reservePrefix({ journalBytes: 2, instance: "user/data" })
					.pipe(Scope.provide(leaseScope));
				expect(tight.snapshot().bytes).toBe(idle + 128 * MiB + runBytes);
				const unfit = yield* Effect.flip(
					Effect.scoped(
						tight.reservePrefix({
							instance: "system/core",
							journalBytes: SANDBOX_LIMITS.journalBytes,
						}),
					),
				);
				expect(unfit.kind).toBe("resource-unavailable");
				expect(unfit.message).toBe("Sandbox execution cannot fit the required idle topology");
				yield* tight.reserveProcess("user/data", 1, lazy).pipe(Scope.provide(processScope));
				yield* lazy.enter({ generation: 1, lane: "interactive", instance: "user/data" });
				expect(tight.snapshot()).toMatchObject({
					runs: 1,
					processes: 1,
					bytes: idle + 128 * MiB + runBytes,
				});

				const secondAdmitted = yield* Deferred.make<void>();
				const second = yield* Effect.scoped(
					tight
						.reservePrefix({ journalBytes: 2, instance: "user/full" })
						.pipe(Effect.andThen(Deferred.succeed(secondAdmitted, undefined))),
				).pipe(Effect.forkScoped({ startImmediately: true }));
				yield* Effect.yieldNow;
				expect(yield* Deferred.isDone(secondAdmitted)).toBe(false);
				yield* Scope.close(leaseScope, Exit.void);
				yield* Effect.yieldNow;
				expect(tight.snapshot()).toMatchObject({ runs: 0, bytes: idle + 128 * MiB });
				expect(yield* Deferred.isDone(secondAdmitted)).toBe(false);
				yield* Scope.close(processScope, Exit.void);
				yield* Deferred.await(secondAdmitted);
				yield* Fiber.join(second);
				expect(tight.snapshot()).toMatchObject({ runs: 0, bytes: idle, processes: 0 });
			}),
		),
	);
});

const GiB = 1024 * MiB;
const budgetFailure = (result: Result.Result<number, SandboxRunError>) =>
	Result.isFailure(result)
		? { kind: result.failure.kind, message: result.failure.message }
		: result;

it("sandbox_memory_budget_derives_from_effective_memory", () => {
	expect(sandboxMemoryBudgetBytes(Option.none(), 8 * GiB)).toEqual(Result.succeed(1536 * MiB));
	expect(sandboxMemoryBudgetBytes(Option.none(), 2 * GiB)).toEqual(Result.succeed(GiB));
	expect(sandboxMemoryBudgetBytes(Option.some(2048), 8 * GiB)).toEqual(Result.succeed(2 * GiB));
	expect(budgetFailure(sandboxMemoryBudgetBytes(Option.some(2049), 4 * GiB))).toEqual({
		kind: "resource-unavailable",
		message: "Sandbox memory budget exceeds half the effective host memory",
	});
	expect(sandboxMemoryBudgetBytes(Option.some(914), 4 * GiB)).toEqual(Result.succeed(914 * MiB));
	expect(budgetFailure(sandboxMemoryBudgetBytes(Option.some(913), 4 * GiB))).toEqual({
		kind: "resource-unavailable",
		message:
			"Sandbox memory budget cannot fit resident core processes, transient memory and a lazy run",
	});
	for (const effectiveMemory of [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 2, 1.5]) {
		expect(budgetFailure(sandboxMemoryBudgetBytes(Option.none(), effectiveMemory))).toEqual({
			kind: "resource-unavailable",
			message: "Sandbox effective host memory is unavailable",
		});
	}
});
