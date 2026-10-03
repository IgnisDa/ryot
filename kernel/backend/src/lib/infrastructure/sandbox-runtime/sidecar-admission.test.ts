import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { SANDBOX_LIMITS } from "./limits";
import { SandboxSidecarAdmission } from "./sidecar-admission";
import { SIDECAR_PROTOCOL_LIMITS } from "./sidecar-protocol";

const admissionLayer = Layer.effect(SandboxSidecarAdmission, SandboxSidecarAdmission.make).pipe(
	Layer.provide(makeAppConfigLayer()),
);
const MiB = 1024 * 1024;
const acquireScope = Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));

layer(admissionLayer)((test) => {
	test.effect(
		"large journal waiters cannot consume the bytes needed for the admitted replay to start",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const admission = yield* SandboxSidecarAdmission;
					const firstScope = yield* acquireScope;
					const processScope = yield* acquireScope;
					const first = yield* admission
						.reservePrefix({ journal: true, instance: "user/full" })
						.pipe(Scope.provide(firstScope));
					const secondEntered = yield* Deferred.make<void>();
					const releaseSecond = yield* Deferred.make<void>();
					const second = yield* Effect.scoped(
						Effect.gen(function* () {
							const lease = yield* admission.reservePrefix({
								journal: true,
								instance: "user/full",
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
					expect(admission.snapshot().bytes).toBe(256 * 1024 * 1024);
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
						.reservePrefix({ journal: true, instance: "user/full" })
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
					expect(admission.snapshot().bytes).toBe(384 * 1024 * 1024);
					yield* Scope.close(processScope, Exit.void);
					expect(admission.snapshot().bytes).toBe(256 * 1024 * 1024);
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
						.reservePrefix({ journal: false, instance: "system/core" })
						.pipe(Scope.provide(first));
					const singleLeaseBytes = admission.snapshot().bytes;
					yield* admission
						.reservePrefix({ journal: false, instance: "system/core" })
						.pipe(Scope.provide(second));
					const entered = yield* Deferred.make<void>();
					const waiter = yield* Effect.scoped(
						admission
							.reservePrefix({ journal: false, instance: "system/core" })
							.pipe(Effect.tap(() => Deferred.succeed(entered, undefined))),
					).pipe(Effect.forkScoped);
					yield* Effect.yieldNow;
					expect(admission.snapshot().waiting).toBe(1);
					expect(yield* Deferred.isDone(entered)).toBe(false);
					const secondWaiter = yield* Effect.scoped(
						admission.reservePrefix({ journal: false, instance: "system/core" }),
					).pipe(Effect.forkScoped);
					yield* Effect.yieldNow;
					expect(admission.snapshot().waiting).toBe(2);
					const full = yield* Effect.flip(
						admission.reservePrefix({ journal: false, instance: "system/core" }),
					);
					expect(full.message).toBe("Sandbox ephemeral admission queue is full");
					yield* Fiber.interrupt(secondWaiter);
					yield* Fiber.interrupt(waiter);
					expect(admission.snapshot().waiting).toBe(0);
					yield* Scope.close(first, Exit.void);
					yield* Effect.scoped(
						admission.reservePrefix({ journal: false, instance: "system/core" }),
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
						.reservePrefix({ journal: false, instance: "system/core" })
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
					expect(admission.snapshot().bytes).toBe(256 * 1024 * 1024);
					expect(admission.snapshot().runs).toBe(0);
				}),
			),
	);
	test.effect("memory_admission_counts_journals_frames_startups_and_buffers", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const measured = yield* SandboxSidecarAdmission;
				const idle = measured.snapshot().bytes;
				expect(idle).toBe(2 * 128 * MiB);
				const measureScope = yield* acquireScope;
				yield* measured
					.reservePrefix({ journal: false, instance: "system/core" })
					.pipe(Scope.provide(measureScope));
				const runBytes = measured.snapshot().bytes - idle;
				expect(runBytes).toBeGreaterThan(
					(256 + 64) * MiB +
						3 * SIDECAR_PROTOCOL_LIMITS.messageBytes.run +
						12 * SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult +
						8 * SANDBOX_LIMITS.bridge.responseBytes,
				);
				yield* Scope.close(measureScope, Exit.void);

				const journalScope = yield* acquireScope;
				const journal = yield* measured
					.reservePrefix({ journal: true, instance: "system/core" })
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
						sandbox: { memoryBudgetMiB: Math.ceil((idle + 128 * MiB + runBytes) / MiB) },
					}),
				);
				const tight = yield* SandboxSidecarAdmission.make.pipe(Effect.provideContext(tightConfig));
				const leaseScope = yield* acquireScope;
				const processScope = yield* acquireScope;
				const lazy = yield* tight
					.reservePrefix({ journal: false, instance: "user/data" })
					.pipe(Scope.provide(leaseScope));
				expect(tight.snapshot().bytes).toBe(idle + 128 * MiB + runBytes);
				const unfit = yield* Effect.flip(
					Effect.scoped(tight.reservePrefix({ journal: true, instance: "system/core" })),
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
						.reservePrefix({ journal: false, instance: "user/full" })
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
