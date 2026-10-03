import { expect, it, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { Deferred, Effect, Exit, Fiber, Layer, Option, Result, Scope } from "effect";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { SANDBOX_TRANSIENT_MEMORY } from "./host-call-gate";
import { MiB } from "./limits";
import { SandboxSidecarAdmission, sandboxMemoryBudgetBytes } from "./sidecar-admission";

const admissionLayer = Layer.effect(SandboxSidecarAdmission, SandboxSidecarAdmission.make).pipe(
	Layer.provide(makeAppConfigLayer({ sandbox: { memoryBudgetMiB: Option.some(1100) } })),
);
const idleBytes = 2 * 128 * MiB + SANDBOX_TRANSIENT_MEMORY.poolBytes;
const acquireScope = Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));

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
				expect(admission.snapshot()).toMatchObject({ reservations: 0, bytes: idleBytes });
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
					expect(admission.snapshot().bytes).toBe(idleBytes);
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
				expect(reservedBytes).toBe(idleBytes + 298 * MiB + 128 * MiB);
				yield* admission.reserveProcess("user/full", 1, lease).pipe(Scope.provide(processScope));
				const reserved = admission.snapshot();
				expect(reserved).toMatchObject({ processes: 1, bytes: reservedBytes });
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
					expect(admission.snapshot().bytes).toBe(idleBytes);
					expect(admission.snapshot().runs).toBe(0);
				}),
			),
	);
	test.effect("memory_admission_counts_frames_startups_and_buffers", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const measured = yield* SandboxSidecarAdmission;
				const idle = measured.snapshot().bytes;
				expect(idle).toBe(idleBytes);
				const measureScope = yield* acquireScope;
				yield* measured.reserveRun("system/core", "interactive").pipe(Scope.provide(measureScope));
				const runBytes = measured.snapshot().bytes - idle;
				expect(runBytes).toBe(298 * MiB);
				yield* Scope.close(measureScope, Exit.void);

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
