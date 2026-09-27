import { expect, it, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { Deferred, Effect, Exit, Fiber, Layer, Option, Result, Scope } from "effect";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { makeSandboxAdmission } from "./host-call-gate.test-support";
import { MiB } from "./limits";
import { SandboxSidecarAdmission, sandboxMemoryPlan } from "./sidecar-admission";

const admissionLayer = Layer.effect(SandboxSidecarAdmission, SandboxSidecarAdmission.make).pipe(
	Layer.provide(makeAppConfigLayer({ sandbox: { memoryBudgetMiB: Option.some(1100) } })),
);
const idleBytes = (admission: SandboxSidecarAdmission["Service"]) =>
	admission.plan.budget - admission.plan.dynamicBytes;
const acquireScope = Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));
const GiB = 1024 * MiB;
const idleSnapshot = (admission: SandboxSidecarAdmission["Service"]) => ({
	runs: 0,
	waiting: 0,
	processes: 0,
	reservations: 0,
	interactiveBytes: 0,
	bytes: idleBytes(admission),
});
const planFailure = (result: Result.Result<unknown, SandboxRunError>) =>
	Result.isFailure(result)
		? { kind: result.failure.kind, message: result.failure.message }
		: result;

layer(admissionLayer)((test) => {
	test.effect("atomic_admission_keeps_memory_waiters_from_holding_execution_slots", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const admission = yield* SandboxSidecarAdmission;
				const firstScope = yield* acquireScope;
				const smallScope = yield* acquireScope;
				yield* admission.reserveRun("system/core", "interactive").pipe(Scope.provide(firstScope));
				const firstBytes = admission.snapshot().bytes;
				const largeEntered = yield* Deferred.make<void>();
				const large = yield* Effect.scoped(
					admission
						.reserveRun("user/full", "interactive")
						.pipe(Effect.tap(() => Deferred.succeed(largeEntered, undefined))),
				).pipe(Effect.forkScoped({ startImmediately: true }));
				expect(admission.snapshot()).toMatchObject({
					waiting: 1,
					reservations: 1,
					bytes: firstBytes,
				});

				yield* admission.reserveRun("system/core", "interactive").pipe(Scope.provide(smallScope));
				expect(admission.snapshot()).toMatchObject({ waiting: 1, reservations: 2 });
				expect(admission.snapshot().bytes).toBeLessThanOrEqual(admission.snapshot().budget);
				expect(yield* Deferred.isDone(largeEntered)).toBe(false);
				yield* Fiber.interrupt(large);
				expect(admission.snapshot()).toMatchObject({ waiting: 0, reservations: 2 });
				yield* Scope.close(firstScope, Exit.void);
				yield* Scope.close(smallScope, Exit.void);
				expect(admission.snapshot()).toMatchObject({
					reservations: 0,
					bytes: idleBytes(admission),
				});
			}),
		),
	);

	test.effect(
		"lazy process waiters cannot consume the bytes needed for the admitted replay to start",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const firstScope = yield* acquireScope;
					const processScope = yield* acquireScope;
					const admission = yield* SandboxSidecarAdmission;
					const first = yield* admission
						.reserveRun("user/full", "interactive")
						.pipe(Scope.provide(firstScope));
					const secondEntered = yield* Deferred.make<void>();
					const releaseSecond = yield* Deferred.make<void>();
					const second = yield* Effect.scoped(
						Effect.gen(function* () {
							const lease = yield* admission.reserveRun("user/full", "interactive");
							yield* lease.enter({ generation: 1, lane: "interactive", instance: "user/full" });
							yield* Deferred.succeed(secondEntered, undefined);
							yield* Deferred.await(releaseSecond);
						}),
					).pipe(Effect.forkScoped({ startImmediately: true }));
					expect(yield* Deferred.isDone(secondEntered)).toBe(false);
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
					expect(admission.snapshot().bytes).toBe(idleBytes(admission));
				}),
			),
	);
	test.effect("atomically reserves a lazy process with its first run", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const admission = yield* SandboxSidecarAdmission;
				const prefixScope = yield* acquireScope;
				const processScope = yield* acquireScope;
				const lease = yield* admission
					.reserveRun("user/full", "interactive")
					.pipe(Scope.provide(prefixScope));
				const reservedBytes = admission.snapshot().bytes;
				expect(reservedBytes).toBe(idleBytes(admission) + 298 * MiB + 128 * MiB);
				yield* admission.reserveProcess("user/full", 1, lease).pipe(Scope.provide(processScope));
				const reserved = admission.snapshot();
				expect(reserved).toMatchObject({ processes: 1, bytes: reservedBytes });
				yield* lease.enter({ generation: 1, lane: "interactive", instance: "user/full" });
				expect(admission.snapshot().bytes).toBe(reserved.bytes);
				expect(admission.snapshot().runs).toBe(1);
				yield* Scope.close(prefixScope, Exit.void);
				expect(admission.snapshot().runs).toBe(0);
				expect(admission.snapshot().bytes).toBe(idleBytes(admission) + 128 * MiB);
				yield* Scope.close(processScope, Exit.void);
				expect(admission.snapshot().bytes).toBe(idleBytes(admission));
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
					yield* admission.reserveRun("system/core", "interactive").pipe(Scope.provide(first));
					const singleLeaseBytes = admission.snapshot().bytes;
					yield* admission.reserveRun("system/core", "interactive").pipe(Scope.provide(second));
					const entered = yield* Deferred.make<void>();
					const waiter = yield* Effect.scoped(
						admission
							.reserveRun("system/core", "interactive")
							.pipe(Effect.tap(() => Deferred.succeed(entered, undefined))),
					).pipe(Effect.forkScoped);
					yield* Effect.yieldNow;
					expect(admission.snapshot().waiting).toBe(1);
					expect(yield* Deferred.isDone(entered)).toBe(false);
					const secondWaiter = yield* Effect.scoped(
						admission.reserveRun("system/core", "interactive"),
					).pipe(Effect.forkScoped);
					yield* Effect.yieldNow;
					expect(admission.snapshot().waiting).toBe(2);
					const full = yield* Effect.flip(admission.reserveRun("system/core", "interactive"));
					expect(full.message).toBe("Sandbox ephemeral admission queue is full");
					yield* Fiber.interrupt(secondWaiter);
					yield* Fiber.interrupt(waiter);
					expect(admission.snapshot().waiting).toBe(0);
					yield* Scope.close(first, Exit.void);
					yield* Effect.scoped(admission.reserveRun("system/core", "interactive"));
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
						.reserveRun("system/core", "background")
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
					expect(admission.snapshot().bytes).toBe(idleBytes(admission));
					expect(admission.snapshot().runs).toBe(0);
				}),
			),
	);
	test.effect("memory_admission_counts_frames_startups_and_buffers", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const measured = yield* SandboxSidecarAdmission;
				const idle = measured.snapshot().bytes;
				expect(idle).toBe(idleBytes(measured));
				const measureScope = yield* acquireScope;
				yield* measured.reserveRun("system/core", "interactive").pipe(Scope.provide(measureScope));
				const runBytes = measured.snapshot().bytes - idle;
				expect(runBytes).toBe(298 * MiB);
				yield* Scope.close(measureScope, Exit.void);

				const tight = yield* makeSandboxAdmission(Math.ceil((idle + 128 * MiB + runBytes) / MiB));
				const leaseScope = yield* acquireScope;
				const processScope = yield* acquireScope;
				const lazy = yield* tight
					.reserveRun("user/data", "interactive")
					.pipe(Scope.provide(leaseScope));
				expect(tight.snapshot().bytes).toBe(idle + 128 * MiB + runBytes);
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
						.reserveRun("user/full", "interactive")
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

const plannedBudget = (configured: Option.Option<number>, effectiveMemory: number) =>
	Result.map(sandboxMemoryPlan(configured, effectiveMemory), (plan) => plan.budget);
const plannedRegions = (budget: number) =>
	Result.map(sandboxMemoryPlan(Option.some(budget), 8 * GiB), (plan) => ({
		mode: plan.mode,
		dynamic: plan.dynamicBytes / MiB,
		pools: [plan.pools.interactive / MiB, plan.pools.background / MiB],
	}));
const closeTwice = (scope: Scope.Closeable) =>
	Scope.close(scope, Exit.void).pipe(Effect.andThen(Scope.close(scope, Exit.void)));

it("sandbox_memory_budget_derives_from_effective_memory", () => {
	expect(plannedBudget(Option.none(), 8 * GiB)).toEqual(Result.succeed(1536 * MiB));
	expect(plannedBudget(Option.none(), 2 * GiB)).toEqual(Result.succeed(GiB));
	expect(plannedBudget(Option.some(2048), 8 * GiB)).toEqual(Result.succeed(2 * GiB));
	expect(planFailure(sandboxMemoryPlan(Option.some(2049), 4 * GiB))).toEqual({
		kind: "resource-unavailable",
		message: "Sandbox memory budget exceeds half the effective host memory",
	});
	for (const effectiveMemory of [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 2, 1.5]) {
		expect(planFailure(sandboxMemoryPlan(Option.none(), effectiveMemory))).toEqual({
			kind: "resource-unavailable",
			message: "Sandbox effective host memory is unavailable",
		});
	}
});

it.effect("admission_mode_follows_budget_and_admits_background_work", () =>
	Effect.scoped(
		Effect.gen(function* () {
			for (const budget of [800, 853]) {
				expect(planFailure(plannedRegions(budget))).toEqual({
					kind: "resource-unavailable",
					message:
						"Sandbox memory budget cannot fit resident core processes, transient memory and a lazy run",
				});
			}
			expect([854, 964, 1094, 1362, 1363, 1536, 1904].map(plannedRegions)).toEqual([
				Result.succeed({ dynamic: 426, mode: "shared", pools: [172, 172] }),
				Result.succeed({ dynamic: 536, mode: "shared", pools: [172, 172] }),
				Result.succeed({ dynamic: 666, mode: "shared", pools: [172, 172] }),
				Result.succeed({ dynamic: 934, mode: "shared", pools: [172, 172] }),
				Result.succeed({ mode: "lane", dynamic: 852, pools: [83, 172] }),
				Result.succeed({ mode: "lane", dynamic: 965, pools: [83, 232] }),
				Result.succeed({ mode: "lane", dynamic: 1333, pools: [83, 232] }),
			]);

			const admission = yield* makeSandboxAdmission(1094);
			const processScope = yield* acquireScope;
			const backgroundScope = yield* acquireScope;
			const interactiveScope = yield* acquireScope;
			yield* admission.reserveProcess("system/core", 1).pipe(Scope.provide(processScope));
			const background = yield* admission
				.reserveRun("system/core", "background")
				.pipe(Scope.provide(backgroundScope));
			yield* admission.reserveRun("user/core", "interactive").pipe(Scope.provide(interactiveScope));
			expect(admission.snapshot()).toMatchObject({
				reservations: 2,
				bytes: idleBytes(admission) + 2 * 298 * MiB,
			});
			yield* Scope.close(interactiveScope, Exit.void);
			const lazyAdmitted = yield* Deferred.make<void>();
			const lazy = yield* Effect.scoped(
				admission
					.reserveRun("user/data", "interactive")
					.pipe(Effect.andThen(Deferred.succeed(lazyAdmitted, undefined))),
			).pipe(Effect.forkScoped({ startImmediately: true }));
			yield* Effect.yieldNow;
			expect(admission.snapshot()).toMatchObject({ waiting: 1, reservations: 1 });
			expect(yield* Deferred.isDone(lazyAdmitted)).toBe(false);
			yield* background.enter({ generation: 1, lane: "background", instance: "system/core" });
			expect(admission.snapshot().runs).toBe(1);
			yield* Scope.close(backgroundScope, Exit.void);
			yield* Deferred.await(lazyAdmitted);
			yield* Fiber.join(lazy);
			yield* Scope.close(processScope, Exit.void);
			expect(admission.snapshot()).toMatchObject(idleSnapshot(admission));
		}),
	),
);

it.effect("fair_admission_releases_tickets_and_reservations_exactly_once", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const admission = yield* makeSandboxAdmission(1363);
			const idle = idleSnapshot(admission);

			const held = yield* acquireScope;
			yield* admission.reserveRun("system/core", "background").pipe(Scope.provide(held));
			const waiters = yield* Effect.forEach([0, 1], () =>
				Effect.scoped(admission.reserveRun("user/core", "background")).pipe(
					Effect.forkScoped({ startImmediately: true }),
				),
			);
			yield* Effect.yieldNow;
			expect(admission.snapshot()).toMatchObject({ waiting: 2, reservations: 1 });
			const overload = yield* Effect.flip(
				Effect.scoped(admission.reserveRun("user/core", "background")),
			);
			expect(overload.message).toBe("Sandbox ephemeral admission queue is full");
			yield* Effect.forEach(waiters, Fiber.interrupt);
			yield* closeTwice(held);
			expect(admission.snapshot()).toMatchObject(idle);

			const leaseScope = yield* acquireScope;
			const failedStartup = yield* acquireScope;
			const lease = yield* admission
				.reserveRun("user/data", "interactive")
				.pipe(Scope.provide(leaseScope));
			expect(admission.snapshot().interactiveBytes).toBe(426 * MiB);
			yield* admission.reserveProcess("user/data", 1, lease).pipe(Scope.provide(failedStartup));
			yield* closeTwice(failedStartup);
			expect(admission.snapshot()).toMatchObject({
				processes: 0,
				interactiveBytes: 298 * MiB,
				bytes: idle.bytes + 298 * MiB,
			});

			const crashed = yield* acquireScope;
			const firstAttempt = yield* acquireScope;
			yield* admission.reserveProcess("user/data", 2, lease).pipe(Scope.provide(crashed));
			yield* lease
				.enter({ generation: 2, lane: "interactive", instance: "user/data" })
				.pipe(Scope.provide(firstAttempt));
			expect(admission.snapshot()).toMatchObject({ runs: 1, interactiveBytes: 426 * MiB });
			yield* closeTwice(firstAttempt);
			yield* closeTwice(crashed);
			expect(admission.snapshot()).toMatchObject({ runs: 0, interactiveBytes: 298 * MiB });

			const recovered = yield* acquireScope;
			const retry = yield* acquireScope;
			yield* admission.reserveProcess("user/data", 3, lease).pipe(Scope.provide(recovered));
			yield* lease
				.enter({ generation: 3, lane: "interactive", instance: "user/data" })
				.pipe(Scope.provide(retry));
			yield* closeTwice(retry);
			yield* closeTwice(leaseScope);
			expect(admission.snapshot()).toMatchObject({ processes: 1, interactiveBytes: 128 * MiB });
			yield* closeTwice(recovered);
			expect(admission.snapshot()).toMatchObject(idle);
		}),
	),
);
