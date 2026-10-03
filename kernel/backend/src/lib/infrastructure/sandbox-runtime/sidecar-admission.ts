import { PgClient } from "@effect/sql-pg";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { Clock, Context, Deferred, Effect, Layer, Option, Pool, Result, Schema } from "effect";
import type { Scope } from "effect";
import { Reactivity } from "effect/reactivity";

import { AppConfig, databaseConnectionBudget } from "../config/service";
import { DatabaseConnectionLimit } from "../db/session";
import { recordSandboxAdmissionWait } from "../runtime-metrics";
import { MiB, SANDBOX_LIMITS } from "./limits";
import { SIDECAR_PROTOCOL_LIMITS } from "./sidecar-protocol";
import { SANDBOX_TRANSIENT_MEMORY, sandboxTransientPermitBytes } from "./transient-memory";

const processBytes = 128 * MiB;
const residentBytes = 2 * processBytes;
const defaultMemoryBudgetBytes = 1536 * MiB;
const isolateBytes =
	SANDBOX_LIMITS.isolate.heapBytes +
	SANDBOX_LIMITS.isolate.externalBytes +
	SANDBOX_LIMITS.sidecar.heapHeadroomBytes;
const resident = (instance: string) => instance === "system/core" || instance === "user/core";
const outstandingHostCalls = SANDBOX_LIMITS.bridge.concurrentHostCalls + 1;
// Isolate, fixed stack and staging, run start, then per outstanding host call its inbound frame,
// Rust encoding and Rust result delivery, then the done text Rust holds before disposal.
const runBytes =
	isolateBytes +
	15 * MiB +
	28 * MiB +
	outstandingHostCalls * (4 * MiB + 5 * MiB + SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult) +
	SIDECAR_PROTOCOL_LIMITS.messageBytes.done;
const ordinaryPermitBytes = sandboxTransientPermitBytes(
	"httpCall",
	SANDBOX_LIMITS.bridge.requestBytes,
);
const inlinePermitBytes = sandboxTransientPermitBytes(
	"inlineBatch",
	SANDBOX_LIMITS.bridge.requestBytes,
);
const interactiveHeadroomBytes = runBytes + processBytes;

export type SandboxMemoryPlan = {
	readonly budget: number;
	readonly dynamicBytes: number;
	readonly mode: "lane" | "shared";
	readonly pools: Readonly<Record<ExecutionLane, number>>;
};

const laneSchema = Schema.Struct({
	lane: ExecutionLane,
	generation: Schema.Int,
	instance: Schema.String,
});
const encodeLane = Schema.encodeSync(Schema.fromJsonString(laneSchema));

export class SandboxAdmissionLease extends Context.Service<
	SandboxAdmissionLease,
	{
		readonly enter: (
			input: typeof laneSchema.Type,
		) => Effect.Effect<void, SandboxRunError, Scope.Scope>;
	}
>()("SandboxAdmissionLease") {}

type LeaseState = {
	bytes: number;
	instance: string;
	startupBytes: number;
	closed: boolean;
	entering: boolean;
	startup: string | undefined;
	entered: string | undefined;
	lane: ExecutionLane;
};

const limitError = (message: string) =>
	new SandboxRunError({ message, kind: "resource-unavailable" });

// Lane mode keeps one interactive run with a lazy process beside one background run with its own, and
// caps the background pool at one inline batch plus its evidence. Shared mode has one inline-sized pool.
export const sandboxMemoryPlan = (
	configuredMiB: Option.Option<number>,
	effectiveMemory: number,
): Result.Result<SandboxMemoryPlan, SandboxRunError> => {
	if (!Number.isSafeInteger(effectiveMemory) || effectiveMemory <= 0) {
		return Result.fail(limitError("Sandbox effective host memory is unavailable"));
	}
	const halfMemory = Math.floor(effectiveMemory / 2);
	const budget = Option.match(configuredMiB, {
		onSome: (mebibytes) => mebibytes * MiB,
		onNone: () => Math.min(defaultMemoryBudgetBytes, halfMemory),
	});
	if (budget > halfMemory) {
		return Result.fail(limitError("Sandbox memory budget exceeds half the effective host memory"));
	}
	const available = budget - residentBytes;
	if (available >= ordinaryPermitBytes + inlinePermitBytes + 2 * interactiveHeadroomBytes) {
		const background = Math.min(
			available - ordinaryPermitBytes - 2 * interactiveHeadroomBytes,
			inlinePermitBytes + SANDBOX_TRANSIENT_MEMORY.inlineEvidenceBytes,
		);
		return Result.succeed({
			budget,
			mode: "lane",
			pools: { background, interactive: ordinaryPermitBytes },
			dynamicBytes: available - ordinaryPermitBytes - background,
		});
	}
	if (available >= inlinePermitBytes + interactiveHeadroomBytes) {
		return Result.succeed({
			budget,
			mode: "shared",
			dynamicBytes: available - inlinePermitBytes,
			pools: { background: inlinePermitBytes, interactive: inlinePermitBytes },
		});
	}
	return Result.fail(
		limitError(
			"Sandbox memory budget cannot fit resident core processes, transient memory and a lazy run",
		),
	);
};

export class SandboxSidecarAdmission extends Context.Service<SandboxSidecarAdmission>()(
	"SandboxSidecarAdmission",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const concurrency = config.sandbox.workerConcurrency;
			const plan = yield* Effect.fromResult(
				sandboxMemoryPlan(config.sandbox.memoryBudgetMiB, process.constrainedMemory()),
			);
			const budget = plan.budget;
			yield* Effect.logInfo("Sandbox memory admission planned").pipe(
				Effect.annotateLogs({
					mode: plan.mode,
					budgetBytes: budget,
					dynamicBytes: plan.dynamicBytes,
					backgroundPoolBytes: plan.pools.background,
					interactivePoolBytes: plan.pools.interactive,
				}),
			);
			const reactivity = yield* Reactivity.make;
			const database = yield* Pool.makeWithTTL({
				min: 0,
				timeToLive: "60 seconds",
				max: databaseConnectionBudget(config).sandboxDispatch,
				acquire: PgClient.makeClient({
					url: config.database.url,
					connectTimeout: config.database.connectionTimeoutMs,
				}).pipe(Effect.provideService(Reactivity.Reactivity, reactivity)),
			});
			const changed = new Set<Deferred.Deferred<void>>();
			const admissionChanged = new Set<Deferred.Deferred<void>>();
			const instances = new Map<
				string,
				{ bytes: number; generation: number; lane: ExecutionLane | undefined }
			>();
			const leases = new WeakMap<SandboxAdmissionLease["Service"], LeaseState>();
			const open = new Set<LeaseState>();
			const lanes = new Map<string, number>();
			const state = { runs: 0, waiting: 0, reservations: 0, bytes: budget - plan.dynamicBytes };
			let pressure = Deferred.makeUnsafe<void>();
			const notify = () => {
				const waiting = [...changed, ...admissionChanged];
				changed.clear();
				admissionChanged.clear();
				for (const waiter of waiting) {
					Deferred.doneUnsafe(waiter, Effect.void);
				}
			};
			const interactiveBytes = () => {
				let bytes = 0;
				for (const lease of open) {
					if (lease.lane === "interactive") {
						bytes += lease.bytes;
					}
				}
				for (const instance of instances.values()) {
					if (instance.lane === "interactive") {
						bytes += instance.bytes;
					}
				}
				return bytes;
			};
			const fits = (lane: ExecutionLane | undefined, amount: number) =>
				state.bytes + amount <=
				budget -
					(plan.mode === "lane" && lane === "background"
						? Math.max(0, interactiveHeadroomBytes - interactiveBytes())
						: 0);
			// Registers synchronously with the failed check, so a release in between cannot be missed.
			const awaitChange = (waiters: Set<Deferred.Deferred<void>>, reclaimable: boolean) => {
				const waiter = Deferred.makeUnsafe<void>();
				waiters.add(waiter);
				if (reclaimable) {
					Deferred.doneUnsafe(pressure, Effect.void);
				}
				return Deferred.await(waiter).pipe(
					Effect.ensuring(Effect.sync(() => waiters.delete(waiter))),
				);
			};
			const reserveBytes = Effect.fnUntraced(function* (
				lane: ExecutionLane | undefined,
				amount: number,
				commit: () => void,
				valid: () => boolean,
			) {
				if (amount > plan.dynamicBytes) {
					return yield* limitError("Sandbox execution cannot fit the required idle topology");
				}
				// A credited start already holds its bytes, so it never waits on the headroom.
				if (amount > 0) {
					while (!fits(lane, amount)) {
						if (!valid()) {
							return yield* limitError("Sandbox reservation owner closed while waiting");
						}
						yield* awaitChange(changed, true);
					}
				}
				if (!valid()) {
					return yield* limitError("Sandbox reservation owner closed while waiting");
				}
				state.bytes += amount;
				commit();
				return undefined;
			});
			const releaseRun = (lease: LeaseState) => {
				if (lease.entered !== undefined) {
					state.runs--;
					const count = lanes.get(lease.entered) ?? 0;
					if (count <= 1) {
						lanes.delete(lease.entered);
					} else {
						lanes.set(lease.entered, count - 1);
					}
					lease.entered = undefined;
				}
				lease.entering = false;
				lease.startup = undefined;
				notify();
			};
			const reserveProcess = Effect.fn("SandboxSidecarAdmission.reserveProcess")(function* (
				instance: string,
				generation: number,
				firstLease?: SandboxAdmissionLease["Service"],
			) {
				if (instances.has(instance)) {
					return yield* limitError("Sandbox process generation already owns a reservation");
				}
				const lease = firstLease === undefined ? undefined : leases.get(firstLease);
				if (
					firstLease !== undefined &&
					(lease === undefined ||
						lease.closed ||
						lease.entering ||
						lease.entered !== undefined ||
						lease.instance !== instance)
				) {
					return yield* limitError("Sandbox startup requires an active unused admission lease");
				}
				const current = {
					bytes: 0,
					generation,
					lane: resident(instance) ? undefined : lease?.lane,
				};
				const startup =
					lease === undefined ? undefined : encodeLane({ instance, generation, lane: lease.lane });
				instances.set(instance, current);
				if (lease !== undefined) {
					lease.entering = true;
				}
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						if (instances.get(instance) === current) {
							if (!resident(instance)) {
								state.bytes -= current.bytes;
							}
							instances.delete(instance);
							if (lease !== undefined && !lease.closed && lease.startup === startup) {
								releaseRun(lease);
							}
							notify();
						}
					}),
				);
				const credit = Math.min(lease?.startupBytes ?? 0, resident(instance) ? 0 : processBytes);
				yield* reserveBytes(
					lease?.lane,
					(resident(instance) ? 0 : processBytes) - credit,
					() => {
						current.bytes = processBytes;
						if (lease !== undefined) {
							lease.bytes -= credit;
							lease.startupBytes -= credit;
							lease.startup = startup;
							lease.entering = false;
						}
					},
					() => lease === undefined || !lease.closed,
				);
				return undefined;
			});
			const reserveRun = Effect.fn("SandboxSidecarAdmission.reserveRun")(function* (
				runInstance: string,
				lane: ExecutionLane,
			) {
				const waitingAt = yield* Clock.currentTimeMillis;
				const lease: LeaseState = {
					lane,
					bytes: 0,
					closed: false,
					startupBytes: 0,
					entering: false,
					entered: undefined,
					startup: undefined,
					instance: runInstance,
				};
				yield* Effect.uninterruptibleMask((restore) =>
					Effect.gen(function* () {
						let waiting = false;
						open.add(lease);
						yield* Effect.addFinalizer(() =>
							Effect.sync(() => {
								lease.closed = true;
								open.delete(lease);
								releaseRun(lease);
								if (lease.bytes > 0) {
									state.reservations--;
									state.bytes -= lease.bytes;
									lease.bytes = 0;
								}
								notify();
							}),
						);
						return yield* Effect.gen(function* () {
							for (;;) {
								if (lease.closed) {
									return yield* limitError("Sandbox reservation owner closed while waiting");
								}
								const startupBytes =
									resident(runInstance) || (instances.get(runInstance)?.bytes ?? 0) > 0
										? 0
										: processBytes;
								const amount = runBytes + startupBytes;
								if (state.reservations < concurrency && fits(lane, amount)) {
									state.reservations++;
									state.bytes += amount;
									lease.bytes = amount;
									lease.startupBytes = startupBytes;
									return undefined;
								}
								if (!waiting) {
									if (state.waiting >= concurrency) {
										return yield* limitError("Sandbox ephemeral admission queue is full");
									}
									waiting = true;
									state.waiting++;
								}
								yield* restore(awaitChange(admissionChanged, state.reservations < concurrency));
							}
						}).pipe(
							Effect.ensuring(
								Effect.sync(() => {
									if (waiting) {
										state.waiting--;
									}
								}),
							),
						);
					}),
				);
				const enter = Effect.fnUntraced(function* (target: typeof laneSchema.Type) {
					const key = encodeLane(target);
					const instance = instances.get(target.instance);
					if (
						lease.closed ||
						lease.instance !== target.instance ||
						lease.lane !== target.lane ||
						lease.entering ||
						lease.entered !== undefined ||
						instance?.generation !== target.generation ||
						instance.bytes === 0 ||
						(lanes.get(key) ?? 0) >= concurrency * 2
					) {
						return yield* limitError(
							"Sandbox lane admission rejected its generation or outstanding count",
						);
					}
					lease.entering = true;
					yield* Effect.addFinalizer(() => Effect.sync(() => releaseRun(lease)));
					if (instances.get(target.instance) !== instance) {
						return yield* limitError("Sandbox generation closed during admission");
					}
					lease.entering = false;
					lease.startup = undefined;
					state.bytes -= lease.startupBytes;
					lease.bytes -= lease.startupBytes;
					lease.startupBytes = 0;
					notify();
					lease.entered = key;
					state.runs++;
					lanes.set(key, (lanes.get(key) ?? 0) + 1);
					return undefined;
				});
				const service = { enter };
				yield* recordSandboxAdmissionWait((yield* Clock.currentTimeMillis) - waitingAt);
				leases.set(service, lease);
				return service;
			});
			return {
				plan,
				reserveRun,
				reserveProcess,
				maximumActive: concurrency,
				leased: (instance: string) => [...open].some((lease) => lease.instance === instance),
				isolateMemoryBytes: concurrency * (isolateBytes + SIDECAR_PROTOCOL_LIMITS.messageBytes.run),
				withDatabaseLimit: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
					effect.pipe(Effect.provideService(DatabaseConnectionLimit, database)),
				pressure: Effect.suspend(() => Deferred.await(pressure)).pipe(
					Effect.andThen(
						Effect.sync(() => {
							pressure = Deferred.makeUnsafe<void>();
						}),
					),
				),
				snapshot: () => ({
					...state,
					budget,
					mode: plan.mode,
					processes: instances.size,
					interactiveBytes: interactiveBytes(),
					waiting: state.waiting + changed.size,
				}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
