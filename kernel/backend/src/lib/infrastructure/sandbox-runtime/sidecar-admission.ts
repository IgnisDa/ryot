import { PgClient } from "@effect/sql-pg";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { Clock, Context, Deferred, Effect, Layer, Option, Pool, Result, Schema } from "effect";
import type { Scope } from "effect";
import { Reactivity } from "effect/reactivity";

import { AppConfig, databaseConnectionBudget } from "../config/service";
import { DatabaseConnectionLimit } from "../db/session";
import { recordSandboxAdmissionWait } from "../runtime-metrics";
import { MiB, SANDBOX_LIMITS } from "./limits";
import { SIDECAR_PROTOCOL_LIMITS, SidecarLane } from "./sidecar-protocol";

const processBytes = 128 * MiB;
const defaultMemoryBudgetBytes = 1536 * MiB;
const isolateBytes =
	SANDBOX_LIMITS.isolate.heapBytes +
	SANDBOX_LIMITS.isolate.externalBytes +
	SANDBOX_LIMITS.sidecar.heapHeadroomBytes;
const resident = (instance: string) => instance === "system/core" || instance === "user/core";
const journalCopies = 3;
const runBytes =
	isolateBytes +
	(8 + 4 + 1 + 2) * MiB +
	3 * SIDECAR_PROTOCOL_LIMITS.messageBytes.run +
	4 * SANDBOX_LIMITS.execution.requestBytes +
	3 * SANDBOX_LIMITS.compiler.javascriptBytes +
	12 * SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult +
	3 * 14 * MiB +
	8 * SANDBOX_LIMITS.bridge.responseBytes +
	2 * SIDECAR_PROTOCOL_LIMITS.messageBytes.done;

const reservationSchema = Schema.Struct({ instance: Schema.String, journalBytes: Schema.Int });
const laneSchema = Schema.Struct({
	lane: SidecarLane,
	generation: Schema.Int,
	instance: Schema.String,
});
const encodeLane = Schema.encodeSync(Schema.fromJsonString(laneSchema));

export class SandboxAdmissionLease extends Context.Service<
	SandboxAdmissionLease,
	{
		readonly retainJournal: (bytes: number) => Effect.Effect<void, SandboxRunError>;
		readonly enter: (
			input: typeof laneSchema.Type,
		) => Effect.Effect<void, SandboxRunError, Scope.Scope>;
	}
>()("SandboxAdmissionLease") {}

type LeaseState = {
	bytes: number;
	instance: string;
	journalBytes: number;
	startupBytes: number;
	closed: boolean;
	entering: boolean;
	startup: string | undefined;
	lane: string | undefined;
};

const limitError = (message: string) =>
	new SandboxRunError({ message, kind: "resource-unavailable" });

export const sandboxMemoryBudgetBytes = (
	configuredMiB: Option.Option<number>,
	effectiveMemory: number,
): Result.Result<number, SandboxRunError> => {
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
	if (2 * processBytes + runBytes > budget) {
		return Result.fail(
			limitError("Sandbox memory budget cannot fit resident core processes and a run"),
		);
	}
	return Result.succeed(budget);
};

export class SandboxSidecarAdmission extends Context.Service<SandboxSidecarAdmission>()(
	"SandboxSidecarAdmission",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const concurrency = config.sandbox.workerConcurrency;
			const budget = yield* Effect.fromResult(
				sandboxMemoryBudgetBytes(config.sandbox.memoryBudgetMiB, process.constrainedMemory()),
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
			const instances = new Map<string, { bytes: number; generation: number }>();
			const leases = new WeakMap<SandboxAdmissionLease["Service"], LeaseState>();
			const lanes = new Map<string, number>();
			const state = { runs: 0, waiting: 0, reservations: 0, bytes: 2 * processBytes };
			const notify = () => {
				const waiting = [...changed, ...admissionChanged];
				changed.clear();
				admissionChanged.clear();
				for (const waiter of waiting) {
					Deferred.doneUnsafe(waiter, Effect.void);
				}
			};
			const reserveBytes = Effect.fnUntraced(function* (
				amount: number,
				commit: () => void,
				valid: () => boolean = () => true,
			) {
				if (amount > budget - 2 * processBytes) {
					return yield* limitError("Sandbox execution cannot fit the required idle topology");
				}
				while (state.bytes + amount > budget) {
					if (!valid()) {
						return yield* limitError("Sandbox reservation owner closed while waiting");
					}
					const waiter = yield* Deferred.make<void>();
					changed.add(waiter);
					yield* Deferred.await(waiter).pipe(
						Effect.ensuring(Effect.sync(() => changed.delete(waiter))),
					);
				}
				if (!valid()) {
					return yield* limitError("Sandbox reservation owner closed while waiting");
				}
				state.bytes += amount;
				commit();
				return undefined;
			});
			const releaseRun = (lease: LeaseState) => {
				if (lease.lane !== undefined) {
					state.runs--;
					const count = lanes.get(lease.lane) ?? 0;
					if (count <= 1) {
						lanes.delete(lease.lane);
					} else {
						lanes.set(lease.lane, count - 1);
					}
					lease.lane = undefined;
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
						lease.lane !== undefined ||
						lease.instance !== instance)
				) {
					return yield* limitError("Sandbox startup requires an active unused admission lease");
				}
				const current = { bytes: 0, generation };
				const startup = encodeLane({ instance, generation, lane: "interactive" });
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
			const reservePrefix = Effect.fn("SandboxSidecarAdmission.reservePrefix")(function* (
				input: typeof reservationSchema.Type,
			) {
				const waitingAt = yield* Clock.currentTimeMillis;
				if (
					!Number.isSafeInteger(input.journalBytes) ||
					input.journalBytes < 2 ||
					input.journalBytes > SANDBOX_LIMITS.journalBytes
				) {
					return yield* limitError("Sandbox journal reservation is invalid");
				}
				const initialBytes = journalCopies * input.journalBytes;
				if (
					initialBytes + runBytes + (resident(input.instance) ? 0 : processBytes) >
					budget - 2 * processBytes
				) {
					return yield* limitError("Sandbox execution cannot fit the required idle topology");
				}
				const lease: LeaseState = {
					bytes: 0,
					closed: false,
					journalBytes: 0,
					startupBytes: 0,
					entering: false,
					lane: undefined,
					startup: undefined,
					instance: input.instance,
				};
				yield* Effect.uninterruptibleMask((restore) =>
					Effect.gen(function* () {
						let waiting = false;
						yield* Effect.addFinalizer(() =>
							Effect.sync(() => {
								lease.closed = true;
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
									resident(input.instance) || (instances.get(input.instance)?.bytes ?? 0) > 0
										? 0
										: processBytes;
								const amount = initialBytes + runBytes + startupBytes;
								if (state.reservations < concurrency && state.bytes + amount <= budget) {
									state.reservations++;
									state.bytes += amount;
									lease.bytes = amount;
									lease.journalBytes = initialBytes;
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
								const waiter = yield* Deferred.make<void>();
								admissionChanged.add(waiter);
								yield* restore(Deferred.await(waiter)).pipe(
									Effect.ensuring(Effect.sync(() => admissionChanged.delete(waiter))),
								);
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
				const retainJournal = Effect.fnUntraced(function* (
					retainedBytes: number,
				): Effect.fn.Return<void, SandboxRunError> {
					if (
						!Number.isSafeInteger(retainedBytes) ||
						retainedBytes < 0 ||
						retainedBytes > SANDBOX_LIMITS.journalBytes
					) {
						return yield* limitError("Sandbox retained journal exceeds its reservation");
					}
					const next = journalCopies * retainedBytes;
					if (
						lease.closed ||
						lease.entering ||
						lease.lane !== undefined ||
						next > lease.journalBytes
					) {
						return yield* limitError("Sandbox journal reservation cannot grow after loading");
					}
					state.bytes -= lease.journalBytes - next;
					lease.bytes -= lease.journalBytes - next;
					lease.journalBytes = next;
					notify();
					return undefined;
				});
				const enter = Effect.fnUntraced(function* (lane: typeof laneSchema.Type) {
					const key = encodeLane(lane);
					const instance = instances.get(lane.instance);
					if (
						lease.closed ||
						lease.instance !== lane.instance ||
						lease.entering ||
						lease.lane !== undefined ||
						instance?.generation !== lane.generation ||
						instance.bytes === 0 ||
						(lanes.get(key) ?? 0) >= concurrency * 2
					) {
						return yield* limitError(
							"Sandbox lane admission rejected its generation or outstanding count",
						);
					}
					lease.entering = true;
					yield* Effect.addFinalizer(() => Effect.sync(() => releaseRun(lease)));
					if (instances.get(lane.instance) !== instance) {
						return yield* limitError("Sandbox generation closed during admission");
					}
					lease.entering = false;
					lease.startup = undefined;
					state.bytes -= lease.startupBytes;
					lease.bytes -= lease.startupBytes;
					lease.startupBytes = 0;
					notify();
					lease.lane = key;
					state.runs++;
					lanes.set(key, (lanes.get(key) ?? 0) + 1);
					return undefined;
				});
				const service = { enter, retainJournal };
				yield* recordSandboxAdmissionWait((yield* Clock.currentTimeMillis) - waitingAt);
				leases.set(service, lease);
				return service;
			});
			return {
				reservePrefix,
				reserveProcess,
				maximumActive: concurrency,
				isolateMemoryBytes: concurrency * (isolateBytes + SIDECAR_PROTOCOL_LIMITS.messageBytes.run),
				snapshot: () => ({
					...state,
					budget,
					processes: instances.size,
					waiting: state.waiting + changed.size,
				}),
				withDatabaseLimit: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
					effect.pipe(Effect.provideService(DatabaseConnectionLimit, database)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
