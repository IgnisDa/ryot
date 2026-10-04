import { assert, expect, layer } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { hostSuccess } from "@ryot-app/sandbox-sdk/wire";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import {
	Clock,
	Context,
	Deferred,
	Effect,
	Exit,
	Fiber,
	Layer,
	Metric,
	Queue,
	Scope,
	Schema,
} from "effect";
import { TestClock } from "effect/testing";

import { AppConfig } from "#lib/infrastructure/config/service";
import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { SandboxRecoveryStore } from "../sandbox-recovery-store";
import { SandboxExecutionAuthority, type SandboxExecutionPrincipal } from "./execution-principal";
import { SandboxHostCallGate, type SandboxHostCallGateRegistration } from "./host-call-gate";
import type { SandboxRunInput } from "./shared";
import { SandboxSidecarAdmission } from "./sidecar-admission";
import { SandboxSidecarClient } from "./sidecar-client";
import {
	SidecarHostCallFrame,
	type SidecarOutboundFrame as OutboundFrame,
	type SidecarDoneFrame,
	type SidecarRunFrame,
	SidecarHostResultFrame,
	type SidecarInboundFrame,
} from "./sidecar-protocol";
import { SandboxSidecarQuarantine } from "./sidecar-quarantine";
import { SandboxSidecarSupervisor, type SandboxSidecarRun } from "./sidecar-supervisor";

type Connection = Effect.Success<ReturnType<SandboxSidecarClient["Service"]["connect"]>>;
type ConnectSettings = Parameters<SandboxSidecarClient["Service"]["connect"]>[0];
type RunFrame = typeof SidecarRunFrame.Type;
type DoneFrame = typeof SidecarDoneFrame.Type;
type HostCallFrame = typeof SidecarHostCallFrame.Type;
type HostResultFrame = Extract<SidecarInboundFrame, { readonly type: "hostResult" }>;
type RecoveryOperation = "clear" | "collateral" | "read" | "resume";
type RecoveryState = { recoveries: number; suspended: boolean };
type MutableRecoveryState = RecoveryState & {
	readonly eventIds: Set<string>;
	healthyEpoch: string | undefined;
};
type RecoveryCall = RecoveryState & {
	readonly executionId: string;
	readonly instance: string;
	readonly operation: RecoveryOperation;
	readonly pinHash: string;
	readonly eventId?: string;
	readonly healthyEpoch?: string;
};
type ProtectionEvent = {
	readonly principal: SandboxExecutionPrincipal;
	readonly trust: "system" | "user";
	readonly type: "open" | "strike" | "survived";
};
type PreparedInput = {
	readonly generation: number;
	readonly handle: string;
	readonly input: RunFrame["input"];
};
type HostDispatch = {
	readonly generation: number;
	readonly handle: string;
	readonly name: string;
	readonly seq: number;
};

type RecordingEvent = {
	readonly at?: number;
	readonly frame?: SidecarInboundFrame | OutboundFrame;
	readonly generation: number;
	readonly handle?: string;
	readonly instance: string;
	readonly type: string;
};

type RecordedConnection = {
	readonly closeAllowed: Deferred.Deferred<void>;
	readonly closeRequested: Deferred.Deferred<void>;
	readonly connectedAt: number;
	connection?: Connection;
	readonly diagnostics: string;
	readonly exitConfirmed: Deferred.Deferred<void>;
	readonly generation: number;
	readonly incoming: Queue.Queue<OutboundFrame>;
	readonly instance: string;
	readonly nextCancel: Queue.Queue<Extract<SidecarInboundFrame, { readonly type: "cancel" }>>;
	readonly nextHostResult: Queue.Queue<HostResultFrame>;
	readonly nextRun: Queue.Queue<RunFrame>;
	readonly pid: number;
	readonly readyConsumed: Deferred.Deferred<void>;
	readonly drainingReceived: Deferred.Deferred<void>;
	readonly registered: Set<string>;
	readonly retired: Array<string>;
	readonly sent: Array<SidecarInboundFrame>;
	readonly settings: ConnectSettings;
	closeHeld: boolean;
	finalized: boolean;
};

type HarnessService = {
	readonly connections: Array<RecordedConnection>;
	readonly connectionsAdded: Queue.Queue<RecordedConnection>;
	readonly events: Array<RecordingEvent>;
	readonly hostDispatches: Array<HostDispatch>;
	readonly prepareInputs: Array<PreparedInput>;
	readonly protectionEvents: Array<ProtectionEvent>;
	readonly recoveryCalls: Array<RecoveryCall>;
	readonly recoveryNotifications: Queue.Queue<RecoveryCall>;
	readonly recoveryStates: Map<string, MutableRecoveryState>;
	readonly confirmClose: (generation: number) => Effect.Effect<void>;
	readonly connect: SandboxSidecarClient["Service"]["connect"];
	readonly complete: (connection: RecordedConnection, run: RunFrame) => Effect.Effect<void>;
	readonly delayClose: (generation: number) => Effect.Effect<void>;
	readonly emit: (generation: number, frame: OutboundFrame) => Effect.Effect<void>;
};

class SupervisorTestHarness extends Context.Service<SupervisorTestHarness, HarnessService>()(
	"SupervisorTestHarness",
) {}

const MiB = 1024 * 1024;
const userId = UserId.make("gate-user");
const moduleSource = "export default async () => null;";
const dataRuntimeImports = ["@ryot-app/sandbox-sdk/fflate"];

const makeRecordingHarness = Effect.gen(function* () {
	const connections: Array<RecordedConnection> = [];
	const connectionsAdded = yield* Queue.unbounded<RecordedConnection>();
	const events: Array<RecordingEvent> = [];
	const hostDispatches: Array<HostDispatch> = [];
	const prepareInputs: Array<PreparedInput> = [];
	const protectionEvents: Array<ProtectionEvent> = [];
	const recoveryCalls: Array<RecoveryCall> = [];
	const recoveryNotifications = yield* Queue.unbounded<RecoveryCall>();
	const recoveryStates = new Map<string, MutableRecoveryState>();

	const recordFor = (generation: number) => {
		const record = connections.find((candidate) => candidate.generation === generation);
		if (record === undefined) {
			throw new Error(`No recording connection for generation ${generation}`);
		}
		return record;
	};

	const connect: SandboxSidecarClient["Service"]["connect"] = Effect.fnUntraced(function* (
		settings: ConnectSettings,
	) {
		const connectedAt = yield* Clock.currentTimeMillis;
		const generation = settings.generation;
		const instance = `${settings.trust}/${settings.tier}`;
		const pid = 20_000 + generation;
		const incoming = yield* Queue.unbounded<OutboundFrame>();
		const nextRun = yield* Queue.unbounded<RunFrame>();
		const nextHostResult = yield* Queue.unbounded<HostResultFrame>();
		const nextCancel =
			yield* Queue.unbounded<Extract<SidecarInboundFrame, { readonly type: "cancel" }>>();
		const closeRequested = yield* Deferred.make<void>();
		const closeAllowed = yield* Deferred.make<void>();
		const exitConfirmed = yield* Deferred.make<void>();
		const readyConsumed = yield* Deferred.make<void>();
		const drainingReceived = yield* Deferred.make<void>();
		const record: RecordedConnection = {
			pid,
			nextRun,
			incoming,
			instance,
			sent: [],
			settings,
			generation,
			nextCancel,
			connectedAt,
			retired: [],
			closeAllowed,
			exitConfirmed,
			readyConsumed,
			nextHostResult,
			closeRequested,
			closeHeld: false,
			finalized: false,
			drainingReceived,
			registered: new Set(),
			diagnostics: `recording sidecar pid=${pid} generation=${generation}`,
		};
		const connectionClose = Effect.uninterruptible(
			Effect.gen(function* () {
				if (!(yield* Deferred.isDone(closeRequested))) {
					events.push({ instance, generation, type: "close-request" });
					yield* Deferred.succeed(closeRequested, undefined);
				}
				if (record.closeHeld) {
					yield* Deferred.await(closeAllowed);
				}
				if (!record.finalized) {
					record.finalized = true;
					events.push({ instance, generation, type: "exit-confirmed" });
					yield* Deferred.succeed(exitConfirmed, undefined);
				}
				return undefined;
			}),
		);
		const connection: Connection = {
			pid,
			generation,
			close: connectionClose,
			diagnostics: () => record.diagnostics,
			exit: Deferred.await(exitConfirmed).pipe(Effect.as({ code: 0, signal: null })),
			register: (handle) =>
				Effect.sync(() => {
					record.registered.add(handle);
					events.push({ handle, instance, generation, type: "register" });
				}).pipe(Effect.as(undefined)),
			retire: (handle) =>
				Effect.sync(() => {
					record.registered.delete(handle);
					record.retired.push(handle);
					events.push({ handle, instance, generation, type: "retire" });
				}),
			next: Effect.gen(function* () {
				const frame = yield* Queue.take(incoming);
				if (frame.type === "ready") {
					yield* Deferred.succeed(readyConsumed, undefined);
				}
				if (frame.type === "draining") {
					yield* Deferred.succeed(drainingReceived, undefined);
				}
				return frame;
			}),
			send: (frame) =>
				Effect.gen(function* () {
					record.sent.push(frame);
					events.push({ frame, instance, generation, type: "send", handle: frame.handle });
					if (frame.type === "run") {
						yield* Queue.offer(nextRun, frame);
					}
					if (frame.type === "cancel") {
						yield* Queue.offer(nextCancel, frame);
					}
					if (frame.type === "hostResult") {
						yield* Queue.offer(nextHostResult, frame);
					}
				}),
		};
		record.connection = connection;

		events.push({ instance, generation, at: connectedAt, type: "connect" });
		connections.push(record);
		yield* Queue.offer(connectionsAdded, record);
		yield* Queue.offer(incoming, { generation, type: "ready" });
		yield* Effect.addFinalizer(() => connectionClose);
		return connection;
	});

	return {
		events,
		connect,
		connections,
		prepareInputs,
		recoveryCalls,
		hostDispatches,
		recoveryStates,
		connectionsAdded,
		protectionEvents,
		recoveryNotifications,
		delayClose: (generation) =>
			Effect.sync(() => {
				recordFor(generation).closeHeld = true;
			}),
		confirmClose: (generation) =>
			Effect.gen(function* () {
				const record = recordFor(generation);
				record.closeHeld = false;
				yield* Deferred.succeed(record.closeAllowed, undefined);
				return undefined;
			}),
		complete: (record, run) =>
			Queue.offer(record.incoming, {
				seq: 0,
				type: "done",
				handle: run.handle,
				generation: run.generation,
				console: { entries: [], truncated: false },
				outcome: { value: null, status: "completed" },
			} satisfies DoneFrame).pipe(Effect.asVoid),
		emit: (generation, frame) => {
			const record = recordFor(generation);
			if (frame.type === "draining" || frame.type === "fatal") {
				events.push({
					frame,
					generation,
					...(frame.type === "fatal" ? { handle: frame.handle } : {}),
					type: frame.type,
					instance: record.instance,
				});
			}
			return Queue.offer(record.incoming, frame).pipe(Effect.asVoid);
		},
	} satisfies HarnessService;
});

const configLayer = makeAppConfigLayer({ sandbox: { memoryBudgetMiB: 2048 } });
const harnessLayer = Layer.effect(SupervisorTestHarness, makeRecordingHarness);
const clientLayer = Layer.effect(
	SandboxSidecarClient,
	Effect.map(SupervisorTestHarness, ({ connect }) => ({ connect })),
).pipe(Layer.provideMerge(harnessLayer));
const admissionLayer = Layer.effect(SandboxSidecarAdmission, SandboxSidecarAdmission.make).pipe(
	Layer.provideMerge(configLayer),
);
const authorityLayer = Layer.succeed(SandboxExecutionAuthority, {
	resolve: (_principal: SandboxExecutionPrincipal) => Effect.succeed("user"),
});
const recoveryKey = (executionId: string, instance: string, pinHash: string) =>
	JSON.stringify([executionId, instance, pinHash]);
const recoveryStateFor = (
	harness: HarnessService,
	executionId: string,
	instance: string,
	pinHash: string,
) => {
	const key = recoveryKey(executionId, instance, pinHash);
	let state = harness.recoveryStates.get(key);
	if (state === undefined) {
		state = { recoveries: 0, suspended: false, eventIds: new Set(), healthyEpoch: undefined };
		harness.recoveryStates.set(key, state);
	}
	return state;
};
const copyRecoveryState = (state: MutableRecoveryState): RecoveryState => ({
	suspended: state.suspended,
	recoveries: state.recoveries,
});
const publishRecoveryCall = (
	harness: HarnessService,
	call: Omit<RecoveryCall, "recoveries" | "suspended">,
	state: MutableRecoveryState,
) =>
	Effect.gen(function* () {
		const event = { ...call, ...copyRecoveryState(state) } satisfies RecoveryCall;
		harness.recoveryCalls.push(event);
		yield* Queue.offer(harness.recoveryNotifications, event);
		return copyRecoveryState(state);
	});

const quarantineLayer = Layer.effect(
	SandboxSidecarQuarantine,
	Effect.map(SupervisorTestHarness, (harness) => ({
		open: (principal: SandboxExecutionPrincipal, trust: "system" | "user") =>
			Effect.sync(() => {
				harness.protectionEvents.push({ trust, principal, type: "open" });
				return {
					probation: false,
					identities: ["test"],
					survived: Effect.sync(() => {
						harness.protectionEvents.push({ trust, principal, type: "survived" });
					}),
					recordCrash: Effect.sync(() => {
						harness.protectionEvents.push({ trust, principal, type: "strike" });
					}),
				};
			}),
	})),
).pipe(Layer.provideMerge(harnessLayer));
const recoveryStoreLayer = Layer.effect(
	SandboxRecoveryStore,
	Effect.map(SupervisorTestHarness, (harness) => ({
		read: (executionId: string, instance: string, pinHash: string) => {
			const state = recoveryStateFor(harness, executionId, instance, pinHash);
			return publishRecoveryCall(
				harness,
				{ pinHash, instance, executionId, operation: "read" },
				state,
			);
		},
		clear: (executionId: string, instance: string, pinHash: string) => {
			const state = recoveryStateFor(harness, executionId, instance, pinHash);
			state.recoveries = 0;
			state.suspended = false;
			state.eventIds.clear();
			state.healthyEpoch = undefined;
			return publishRecoveryCall(
				harness,
				{ pinHash, instance, executionId, operation: "clear" },
				state,
			);
		},
		resume: (executionId: string, instance: string, pinHash: string, healthyEpoch: string) => {
			const state = recoveryStateFor(harness, executionId, instance, pinHash);
			if (state.healthyEpoch !== healthyEpoch) {
				state.healthyEpoch = healthyEpoch;
				state.suspended = false;
			}
			return publishRecoveryCall(
				harness,
				{ pinHash, instance, executionId, healthyEpoch, operation: "resume" },
				state,
			);
		},
		collateral: (executionId: string, instance: string, pinHash: string, eventId: string) => {
			const state = recoveryStateFor(harness, executionId, instance, pinHash);
			if (!state.eventIds.has(eventId)) {
				state.eventIds.add(eventId);
				if (state.recoveries < 3) {
					state.recoveries++;
				} else {
					state.suspended = true;
				}
			}
			return publishRecoveryCall(
				harness,
				{ pinHash, eventId, instance, executionId, operation: "collateral" },
				state,
			);
		},
	})),
).pipe(Layer.provideMerge(harnessLayer));
const dependencyLayer = Layer.mergeAll(
	clientLayer,
	admissionLayer,
	authorityLayer,
	quarantineLayer,
	recoveryStoreLayer,
	TestClock.layer(),
);

const getConnection = (harness: HarnessService, instance: string, afterGeneration = 0) => {
	const record = harness.connections.find(
		(candidate) => candidate.instance === instance && candidate.generation > afterGeneration,
	);
	if (record === undefined) {
		throw new Error(`No connection for ${instance} after ${afterGeneration}`);
	}
	return record;
};

const getClientConnection = (record: RecordedConnection) => {
	if (record.connection === undefined) {
		throw new Error(`No client connection for generation ${record.generation}`);
	}
	return record.connection;
};

const awaitConnection = (
	harness: HarnessService,
	instance: string,
	afterGeneration = 0,
): Effect.Effect<RecordedConnection> =>
	Effect.suspend(() => {
		const record = harness.connections.find(
			(candidate) => candidate.instance === instance && candidate.generation > afterGeneration,
		);
		return record === undefined
			? Queue.take(harness.connectionsAdded).pipe(
					Effect.andThen(awaitConnection(harness, instance, afterGeneration)),
				)
			: Deferred.await(record.readyConsumed).pipe(Effect.as(record));
	});

const awaitRecoveryCall = (
	harness: HarnessService,
	predicate: (call: RecoveryCall) => boolean,
): Effect.Effect<RecoveryCall> =>
	Effect.suspend(() => {
		const call = harness.recoveryCalls.find(predicate);
		return call === undefined
			? Queue.take(harness.recoveryNotifications).pipe(
					Effect.andThen(awaitRecoveryCall(harness, predicate)),
				)
			: Effect.succeed(call);
	});

const runMarker = (run: RunFrame) =>
	typeof run.input === "object" && run.input !== null
		? Reflect.get(run.input, "marker")
		: undefined;

const inputMarker = (input: RunFrame["input"]) =>
	typeof input === "object" && input !== null ? Reflect.get(input, "marker") : undefined;

const sentRunFrames = (connection: RecordedConnection) =>
	connection.sent.filter((frame): frame is RunFrame => frame.type === "run");

const makePrincipal = (
	runtimeImports: ReadonlyArray<string>,
	scriptSlug = "supervisor-script",
): SandboxExecutionPrincipal => ({
	scriptSlug,
	providerId: null,
	pluginRevision: null,
	contentHash: sha256Hex(moduleSource),
	scriptId: SandboxScriptId.make(scriptSlug),
	metadata: { kind: "script", runtimeImports },
	subject: {
		userId,
		type: "user",
		accountGeneration: { userId, token: "supervisor-account-generation" },
	},
});

const makePrepare =
	(harness: HarnessService, input: RunFrame["input"] = null): SandboxSidecarRun["prepare"] =>
	(identity) =>
		Effect.gen(function* () {
			harness.prepareInputs.push({
				input,
				handle: identity.handle,
				generation: identity.generation,
			});
			const startedAt = yield* Clock.currentTimeMillis;
			let settledMs = 0;
			let closed = false;
			const gate: SandboxHostCallGateRegistration = {
				journal: undefined,
				inlineEntries: () => [],
				extend: (milliseconds) =>
					Effect.sync(() => {
						settledMs += milliseconds;
					}),
				scriptBudget: Clock.currentTimeMillis.pipe(
					Effect.map((now) => ({
						settledMs,
						remainingMs: Math.max(0, 600_000 - (now - startedAt) + settledMs),
					})),
				),
				close: Effect.sync(() => {
					if (!closed) {
						closed = true;
						harness.events.push({
							type: "gate-close",
							handle: identity.handle,
							instance: identity.instance,
							generation: identity.generation,
						});
					}
				}),
				dispatch: (frame) =>
					Effect.gen(function* () {
						yield* Effect.sync(() =>
							harness.hostDispatches.push({
								seq: frame.seq,
								name: frame.name,
								handle: frame.handle,
								generation: frame.generation,
							}),
						);
						return yield* Schema.decodeEffect(SidecarHostResultFrame)({
							seq: frame.seq,
							type: "hostResult",
							handle: frame.handle,
							generation: frame.generation,
							result: { status: "success", value: { data: null, success: true } },
						}).pipe(Effect.orDie);
					}),
			};
			return {
				gate,
				input,
				finish: () => Effect.void,
				module: { source: moduleSource, sha256: sha256Hex(moduleSource) },
			};
		});

const committedHostCall = (run: RunFrame, seq: number): HostCallFrame =>
	Schema.decodeSync(SidecarHostCallFrame)({
		seq,
		type: "hostCall",
		handle: run.handle,
		args: { args: [] },
		name: "committedAction",
		generation: run.generation,
	});

const startRun = (
	supervisor: SandboxSidecarSupervisor["Service"],
	harness: HarnessService,
	runtimeImports: ReadonlyArray<string> = [],
	options: {
		readonly leaseAcquired?: Deferred.Deferred<void>;
		readonly executionId?: string;
		readonly pinHash?: string;
		readonly principal?: SandboxExecutionPrincipal;
		readonly prepare?: SandboxSidecarRun["prepare"];
	} = {},
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const principal = options.principal ?? makePrincipal(runtimeImports);
			const lease = yield* supervisor.reserve(principal, false);
			if (options.leaseAcquired !== undefined) {
				yield* Deferred.succeed(options.leaseAcquired, undefined);
			}
			return yield* supervisor.run({
				lease,
				principal,
				prepare: options.prepare ?? makePrepare(harness),
				pinHash: options.pinHash ?? sha256Hex(moduleSource),
				executionId: options.executionId ?? crypto.randomUUID(),
			});
		}),
	);

const withSupervisor = <A, E, R>(
	work: (context: {
		readonly admission: SandboxSidecarAdmission["Service"];
		readonly harness: HarnessService;
		readonly supervisor: SandboxSidecarSupervisor["Service"];
	}) => Effect.Effect<A, E, R>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const admission = yield* SandboxSidecarAdmission;
			const harness = yield* SupervisorTestHarness;
			const scope = yield* Scope.make();
			yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
			const supervisor = yield* SandboxSidecarSupervisor.make.pipe(
				Effect.provideService(Scope.Scope, scope),
			);
			const result = yield* work({ harness, admission, supervisor });
			yield* Scope.close(scope, Exit.void);
			expect(harness.connections.every((connection) => connection.finalized)).toBe(true);
			expect(harness.events.filter((event) => event.type === "exit-confirmed")).toHaveLength(
				harness.connections.length,
			);
			expect(admission.snapshot()).toMatchObject({ runs: 0, processes: 0, bytes: 2 * 128 * MiB });
			return result;
		}),
	);

const userCoreConnections = (harness: HarnessService) =>
	harness.connections.filter((connection) => connection.instance === "user/core");

const supervisorTest = <A, E>(
	name: string,
	effect: () => Effect.Effect<A, E, Layer.Success<typeof dependencyLayer> | Scope.Scope>,
) => layer(Layer.fresh(dependencyLayer))((test) => test.effect(name, effect));

supervisorTest("lazy_tiers_start_once_and_stop_only_when_idle", () =>
	withSupervisor(({ harness, admission, supervisor }) =>
		Effect.gen(function* () {
			expect(harness.connections.map((connection) => connection.instance)).toEqual([
				"system/core",
				"user/core",
			]);
			const firstFiber = yield* startRun(supervisor, harness, dataRuntimeImports).pipe(
				Effect.forkScoped({ startImmediately: true }),
			);
			const data = yield* awaitConnection(harness, "user/data");
			const firstRun = yield* Queue.take(data.nextRun);
			const secondFiber = yield* startRun(supervisor, harness, dataRuntimeImports).pipe(
				Effect.forkScoped({ startImmediately: true }),
			);
			const secondRun = yield* Queue.take(data.nextRun);
			expect(
				harness.connections.filter((connection) => connection.instance === "user/data"),
			).toHaveLength(1);
			expect(data.settings).toMatchObject({ tier: "data", trust: "user" });
			const clientConnection = getClientConnection(data);
			expect(clientConnection.generation).toBe(data.generation);
			expect(clientConnection.pid).toBe(data.pid);
			expect(clientConnection.diagnostics()).toContain(`generation=${data.generation}`);
			expect(firstRun.module).toEqual({ source: moduleSource, sha256: sha256Hex(moduleSource) });
			expect(firstRun.input).toBeNull();
			expect(secondRun.module.sha256).toBe(sha256Hex(moduleSource));

			yield* TestClock.adjust("59 seconds");
			expect(supervisor.snapshot()).toEqual({
				totalExecutions: 2,
				activeExecutions: 2,
				maxActiveExecutions: 2,
			});
			const activeMetrics = yield* Metric.snapshot;
			expect(
				activeMetrics.find(
					(metric) =>
						metric.id === "ryot.sandbox.sidecar.outstanding_runs" &&
						metric.attributes?.["trust"] === "user" &&
						metric.attributes["snapshot"] === "data",
				)?.state,
			).toMatchObject({ value: 2 });
			expect(
				activeMetrics.find(
					(metric) =>
						metric.id === "ryot.sandbox.sidecar.events" &&
						metric.attributes?.["trust"] === "user" &&
						metric.attributes["snapshot"] === "data" &&
						metric.attributes["event"] === "ready",
				)?.state,
			).toMatchObject({ count: 1 });
			expect(
				activeMetrics
					.filter((metric) => metric.id.startsWith("ryot.sandbox.sidecar."))
					.every((metric) =>
						Object.keys(metric.attributes ?? {}).every((key) =>
							["unit", "trust", "snapshot", "event", "reason"].includes(key),
						),
					),
			).toBe(true);
			expect(data.finalized).toBe(false);
			yield* harness.complete(data, firstRun);
			yield* harness.complete(data, secondRun);
			yield* Fiber.join(firstFiber);
			yield* Fiber.join(secondFiber);
			expect(supervisor.snapshot()).toEqual({
				totalExecutions: 2,
				activeExecutions: 0,
				maxActiveExecutions: 2,
			});
			expect(data.registered).toEqual(new Set());
			expect(new Set(data.retired)).toEqual(new Set([firstRun.handle, secondRun.handle]));
			yield* TestClock.adjust("59 seconds");
			expect(data.finalized).toBe(false);
			yield* TestClock.adjust("1 second");
			yield* Deferred.await(data.exitConfirmed);
			expect(yield* clientConnection.exit).toEqual({ code: 0, signal: null });
			expect(admission.snapshot()).toMatchObject({ runs: 0, processes: 2, bytes: 2 * 128 * MiB });

			const replacementFiber = yield* startRun(supervisor, harness, dataRuntimeImports).pipe(
				Effect.forkScoped({ startImmediately: true }),
			);
			const replacement = yield* awaitConnection(harness, "user/data", data.generation);
			const replacementRun = yield* Queue.take(replacement.nextRun);
			expect(replacement.generation).toBeGreaterThan(data.generation);
			expect(
				harness.events.findIndex(
					(event) => event.type === "exit-confirmed" && event.generation === data.generation,
				),
			).toBeLessThan(
				harness.events.findIndex(
					(event) => event.type === "connect" && event.generation === replacement.generation,
				),
			);
			yield* harness.complete(replacement, replacementRun);
			yield* Fiber.join(replacementFiber);
			expect(supervisor.snapshot()).toEqual({
				totalExecutions: 3,
				activeExecutions: 0,
				maxActiveExecutions: 2,
			});
		}),
	).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
);

supervisorTest("drain_and_recycle_respect_generation_and_memory_reservations", () =>
	withSupervisor(({ harness, admission, supervisor }) =>
		Effect.gen(function* () {
			const firstFiber = yield* startRun(supervisor, harness, dataRuntimeImports).pipe(
				Effect.forkScoped({ startImmediately: true }),
			);
			const old = yield* awaitConnection(harness, "user/data");
			const firstRun = yield* Queue.take(old.nextRun);
			yield* harness.delayClose(old.generation);
			yield* harness.emit(old.generation, {
				reason: "memory",
				type: "draining",
				generation: old.generation,
			});
			yield* Deferred.await(old.drainingReceived);
			yield* Effect.yieldNow;
			const secondLeaseAcquired = yield* Deferred.make<void>();
			const secondPrepareStarted = yield* Deferred.make<void>();
			const secondFiber = yield* startRun(supervisor, harness, dataRuntimeImports, {
				leaseAcquired: secondLeaseAcquired,
				prepare: (identity) =>
					Deferred.succeed(secondPrepareStarted, undefined).pipe(
						Effect.andThen(makePrepare(harness)(identity)),
					),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			yield* Deferred.await(secondLeaseAcquired);
			yield* Effect.yieldNow;
			expect(yield* Deferred.isDone(secondPrepareStarted)).toBe(false);
			expect(
				harness.connections.filter((connection) => connection.instance === "user/data"),
			).toHaveLength(1);
			expect(admission.snapshot().processes).toBe(3);

			yield* harness.complete(old, firstRun);
			yield* Fiber.join(firstFiber);
			yield* Deferred.await(old.closeRequested);
			expect(old.finalized).toBe(false);
			expect(admission.snapshot().processes).toBe(3);
			expect(admission.snapshot().bytes).toBeGreaterThan(2 * 128 * MiB + 128 * MiB);
			expect(yield* Deferred.isDone(secondPrepareStarted)).toBe(false);

			yield* harness.confirmClose(old.generation);
			const replacement = yield* awaitConnection(harness, "user/data", old.generation);
			const replacementRun = yield* Queue.take(replacement.nextRun);
			expect(old.finalized).toBe(true);
			expect(yield* Deferred.isDone(secondPrepareStarted)).toBe(true);
			expect(admission.snapshot().processes).toBe(3);
			const oldExit = harness.events.findIndex(
				(event) => event.type === "exit-confirmed" && event.generation === old.generation,
			);
			const oldGateClose = harness.events.findIndex(
				(event) => event.type === "gate-close" && event.generation === old.generation,
			);
			const oldCloseRequest = harness.events.findIndex(
				(event) => event.type === "close-request" && event.generation === old.generation,
			);
			const newConnect = harness.events.findIndex(
				(event) => event.type === "connect" && event.generation === replacement.generation,
			);
			expect(oldGateClose).toBeGreaterThanOrEqual(0);
			expect(oldCloseRequest).toBeGreaterThan(oldGateClose);
			expect(oldExit).toBeGreaterThan(oldCloseRequest);
			expect(newConnect).toBeGreaterThan(oldExit);

			yield* harness.complete(replacement, replacementRun);
			yield* Fiber.join(secondFiber);
		}),
	),
);

supervisorTest("restart_backoff_survives_short_lived_generations", () =>
	withSupervisor(({ harness }) =>
		Effect.gen(function* () {
			const first = getConnection(harness, "user/core");
			const failGeneration = (record: RecordedConnection) =>
				harness.emit(record.generation, {
					type: "fatal",
					handle: "unknown-handle",
					generation: record.generation,
					reason: "termination-ignored",
				});

			yield* failGeneration(first);
			yield* Deferred.await(first.exitConfirmed);
			yield* TestClock.adjust("999 millis");
			expect(userCoreConnections(harness)).toHaveLength(1);
			yield* TestClock.adjust("1 millis");
			const second = yield* awaitConnection(harness, "user/core", first.generation);
			expect(second.connectedAt - first.connectedAt).toBe(1000);

			yield* failGeneration(second);
			yield* Deferred.await(second.exitConfirmed);
			yield* TestClock.adjust("1999 millis");
			expect(userCoreConnections(harness)).toHaveLength(2);
			yield* TestClock.adjust("1 millis");
			const third = yield* awaitConnection(harness, "user/core", second.generation);
			expect(third.connectedAt - second.connectedAt).toBe(2000);

			yield* failGeneration(third);
			yield* Deferred.await(third.exitConfirmed);
			yield* TestClock.adjust("3999 millis");
			expect(userCoreConnections(harness)).toHaveLength(3);
			yield* TestClock.adjust("1 millis");
			const fourth = yield* awaitConnection(harness, "user/core", third.generation);
			expect(fourth.connectedAt - third.connectedAt).toBe(4000);

			yield* TestClock.adjust("60 seconds");
			yield* failGeneration(fourth);
			yield* Deferred.await(fourth.exitConfirmed);
			yield* TestClock.adjust("999 millis");
			expect(userCoreConnections(harness)).toHaveLength(4);
			yield* TestClock.adjust("1 millis");
			const fifth = yield* awaitConnection(harness, "user/core", fourth.generation);
			expect(fifth.connectedAt - fourth.connectedAt).toBe(61_000);
		}),
	),
);

supervisorTest("cancellation_before_prepare_completes_does_not_cancel_or_kill_a_generation", () =>
	withSupervisor(({ harness, admission, supervisor }) =>
		Effect.gen(function* () {
			const resident = getConnection(harness, "user/core");
			const before = admission.snapshot();
			const prepareStarted = yield* Deferred.make<void>();
			const releasePrepare = yield* Deferred.make<void>();
			const runFiber = yield* startRun(supervisor, harness, [], {
				prepare: (identity) =>
					Deferred.succeed(prepareStarted, undefined).pipe(
						Effect.andThen(Deferred.await(releasePrepare)),
						Effect.andThen(makePrepare(harness)(identity)),
					),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			yield* Deferred.await(prepareStarted);
			expect(admission.snapshot().runs).toBe(1);
			yield* Fiber.interrupt(runFiber);
			expect(resident.sent).toEqual([]);
			expect(resident.finalized).toBe(false);
			expect(
				harness.events.some(
					(event) => event.type === "close-request" && event.generation === resident.generation,
				),
			).toBe(false);
			expect(admission.snapshot()).toMatchObject({ runs: 0, processes: 2, bytes: before.bytes });
		}),
	),
);

supervisorTest(
	"a_cancel_without_done_disposes_the_generation_after_grace_until_exit_confirmation",
	() =>
		withSupervisor(({ harness, admission, supervisor }) =>
			Effect.gen(function* () {
				const runFiber = yield* startRun(supervisor, harness, dataRuntimeImports).pipe(
					Effect.forkScoped({ startImmediately: true }),
				);
				const data = yield* awaitConnection(harness, "user/data");
				const run = yield* Queue.take(data.nextRun);
				yield* harness.delayClose(data.generation);
				const interruption = yield* Fiber.interrupt(runFiber).pipe(
					Effect.forkScoped({ startImmediately: true }),
				);
				const cancel = yield* Queue.take(data.nextCancel);
				expect(cancel).toMatchObject({
					type: "cancel",
					handle: run.handle,
					generation: data.generation,
				});
				yield* TestClock.adjust("1999 millis");
				expect(data.finalized).toBe(false);
				expect(admission.snapshot().processes).toBe(3);
				yield* TestClock.adjust("1 millis");
				yield* Deferred.await(data.closeRequested);
				expect(data.finalized).toBe(false);
				expect(yield* Deferred.isDone(data.exitConfirmed)).toBe(false);
				expect(admission.snapshot().processes).toBe(3);
				expect(admission.snapshot().bytes).toBeGreaterThan(2 * 128 * MiB);

				yield* harness.confirmClose(data.generation);
				yield* Fiber.join(interruption);
				expect(data.finalized).toBe(true);
				expect(admission.snapshot()).toMatchObject({ runs: 0, processes: 2, bytes: 2 * 128 * MiB });
			}),
		),
);

supervisorTest("unattributed_crash_candidates_probe_one_at_a_time", () =>
	withSupervisor(({ harness, admission, supervisor }) =>
		Effect.gen(function* () {
			const principalA = makePrincipal([], "recovery-candidate-a");
			const principalB = makePrincipal([], "recovery-candidate-b");
			const principalThird = makePrincipal([], "recovery-fresh-third");
			const executionA = crypto.randomUUID();
			const executionB = crypto.randomUUID();
			const executionThird = crypto.randomUUID();
			const inputA = { marker: "candidate-a", journal: { committed: "candidate-a" } };
			const inputB = { marker: "candidate-b", journal: { committed: "candidate-b" } };
			const inputThird = { marker: "fresh-third", journal: { committed: "fresh" } };
			const fiberA = yield* startRun(supervisor, harness, [], {
				principal: principalA,
				executionId: executionA,
				prepare: makePrepare(harness, inputA),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			const initial = getConnection(harness, "user/core");
			const runA = yield* Queue.take(initial.nextRun);
			const fiberB = yield* startRun(supervisor, harness, [], {
				principal: principalB,
				executionId: executionB,
				prepare: makePrepare(harness, inputB),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			const runB = yield* Queue.take(initial.nextRun);
			const candidateOne = runA.handle < runB.handle ? runA : runB;
			const candidateTwo = runA.handle < runB.handle ? runB : runA;
			const candidateOneFiber = runA.handle === candidateOne.handle ? fiberA : fiberB;
			const candidateTwoFiber = runA.handle === candidateTwo.handle ? fiberA : fiberB;
			const candidateOneInput = runA.handle === candidateOne.handle ? inputA : inputB;
			const candidateTwoInput = runA.handle === candidateTwo.handle ? inputA : inputB;

			yield* harness.emit(initial.generation, {
				type: "fatal",
				reason: "termination-ignored",
				generation: initial.generation,
				handle: "unregistered-original-handle",
			});
			yield* Deferred.await(initial.exitConfirmed);
			yield* TestClock.adjust("999 millis");
			expect(userCoreConnections(harness)).toHaveLength(1);
			yield* TestClock.adjust("1 millis");
			const probeConnection = yield* awaitConnection(harness, "user/core", initial.generation);
			const firstProbe = yield* Queue.take(probeConnection.nextRun);
			expect(firstProbe.handle).not.toBe(candidateOne.handle);
			expect(firstProbe.generation).toBe(probeConnection.generation);
			expect(firstProbe.input).toEqual(candidateOneInput);
			expect(firstProbe.module).toEqual(candidateOne.module);
			expect(runMarker(firstProbe)).toBe(runMarker(candidateOne));

			const thirdLeaseAcquired = yield* Deferred.make<void>();
			const thirdFiber = yield* startRun(supervisor, harness, [], {
				principal: principalThird,
				executionId: executionThird,
				leaseAcquired: thirdLeaseAcquired,
				prepare: makePrepare(harness, inputThird),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			yield* harness.complete(probeConnection, firstProbe);
			yield* Fiber.join(candidateOneFiber);
			yield* Deferred.await(thirdLeaseAcquired);
			const secondProbe = yield* Queue.take(probeConnection.nextRun);
			expect(secondProbe.handle).not.toBe(candidateTwo.handle);
			expect(secondProbe.input).toEqual(candidateTwoInput);
			expect(secondProbe.module).toEqual(candidateTwo.module);
			yield* Effect.yieldNow;
			expect(sentRunFrames(probeConnection)).toHaveLength(2);

			yield* harness.complete(probeConnection, secondProbe);
			yield* Fiber.join(candidateTwoFiber);
			const thirdRun = yield* Queue.take(probeConnection.nextRun);
			expect(runMarker(thirdRun)).toBe("fresh-third");
			expect(thirdRun.generation).toBe(probeConnection.generation);
			yield* harness.complete(probeConnection, thirdRun);
			yield* Fiber.join(thirdFiber);
			expect(harness.protectionEvents.filter((event) => event.type === "strike")).toEqual([]);
			expect(
				harness.recoveryCalls.filter(
					(call) =>
						call.operation === "collateral" &&
						(call.executionId === executionA || call.executionId === executionB),
				),
			).toHaveLength(2);
			expect(admission.snapshot().runs).toBe(0);
		}),
	),
);

supervisorTest("exclusive_probe_attributes_only_its_crashing_candidate", () =>
	withSupervisor(({ harness, admission, supervisor }) =>
		Effect.gen(function* () {
			const principalA = makePrincipal([], "exclusive-candidate-a");
			const principalB = makePrincipal([], "exclusive-candidate-b");
			const executionA = crypto.randomUUID();
			const executionB = crypto.randomUUID();
			const inputA = { marker: "candidate-a" };
			const inputB = { marker: "candidate-b" };
			const fiberA = yield* startRun(supervisor, harness, [], {
				principal: principalA,
				executionId: executionA,
				prepare: makePrepare(harness, inputA),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			const initial = getConnection(harness, "user/core");
			const runA = yield* Queue.take(initial.nextRun);
			const fiberB = yield* startRun(supervisor, harness, [], {
				principal: principalB,
				executionId: executionB,
				prepare: makePrepare(harness, inputB),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			const runB = yield* Queue.take(initial.nextRun);
			const candidateOne = runA.handle < runB.handle ? runA : runB;
			const candidateTwo = runA.handle < runB.handle ? runB : runA;
			const candidateOneFiber = runA.handle === candidateOne.handle ? fiberA : fiberB;
			const candidateTwoFiber = runA.handle === candidateTwo.handle ? fiberA : fiberB;
			const candidateOnePrincipal = runA.handle === candidateOne.handle ? principalA : principalB;
			const candidateTwoExecutionId = runA.handle === candidateTwo.handle ? executionA : executionB;
			const candidateTwoInput = runA.handle === candidateTwo.handle ? inputA : inputB;

			yield* harness.emit(initial.generation, {
				type: "fatal",
				reason: "termination-ignored",
				handle: "unknown-before-probe",
				generation: initial.generation,
			});
			yield* Deferred.await(initial.exitConfirmed);
			yield* TestClock.adjust("1 second");
			const probeConnection = yield* awaitConnection(harness, "user/core", initial.generation);
			const exclusiveProbe = yield* Queue.take(probeConnection.nextRun);
			expect(exclusiveProbe.input).toEqual(runA.handle === candidateOne.handle ? inputA : inputB);
			yield* harness.emit(probeConnection.generation, {
				type: "fatal",
				reason: "termination-ignored",
				generation: probeConnection.generation,
				handle: "unknown-during-exclusive-probe",
			});
			yield* Deferred.await(probeConnection.exitConfirmed);
			const attributedFailure = yield* Effect.flip(Fiber.join(candidateOneFiber));
			expect(attributedFailure).toMatchObject({ kind: "script-failure" });
			expect(sentRunFrames(probeConnection)).toHaveLength(1);
			const strikes = harness.protectionEvents.filter((event) => event.type === "strike");
			expect(strikes).toHaveLength(1);
			expect(strikes[0]?.principal.scriptId).toBe(candidateOnePrincipal.scriptId);

			const unrelatedPrincipal = makePrincipal(dataRuntimeImports, "unrelated-data-run");
			const unrelatedFiber = yield* startRun(supervisor, harness, dataRuntimeImports, {
				principal: unrelatedPrincipal,
				prepare: makePrepare(harness, { marker: "unrelated-data" }),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			const dataConnection = yield* awaitConnection(harness, "user/data");
			const unrelatedRun = yield* Queue.take(dataConnection.nextRun);
			expect(runMarker(unrelatedRun)).toBe("unrelated-data");
			yield* harness.complete(dataConnection, unrelatedRun);
			yield* Fiber.join(unrelatedFiber);

			yield* TestClock.adjust("1999 millis");
			expect(userCoreConnections(harness)).toHaveLength(2);
			expect(sentRunFrames(probeConnection)).toHaveLength(1);
			yield* TestClock.adjust("1 millis");
			const secondProbeConnection = yield* awaitConnection(
				harness,
				"user/core",
				probeConnection.generation,
			);
			expect(secondProbeConnection.connectedAt - probeConnection.connectedAt).toBe(2000);
			const secondProbe = yield* Queue.take(secondProbeConnection.nextRun);
			expect(secondProbe.input).toEqual(candidateTwoInput);
			expect(
				userCoreConnections(harness)
					.flatMap(sentRunFrames)
					.filter((frame) => runMarker(frame) === runMarker(candidateOne)),
			).toHaveLength(2);
			yield* harness.complete(secondProbeConnection, secondProbe);
			yield* Fiber.join(candidateTwoFiber);
			expect(
				harness.recoveryCalls.filter(
					(call) => call.operation === "collateral" && call.executionId === candidateTwoExecutionId,
				),
			).toHaveLength(1);
			expect(harness.protectionEvents.filter((event) => event.type === "strike")).toHaveLength(1);
			expect(admission.snapshot().runs).toBe(0);
		}),
	),
);

supervisorTest("collateral_recovery_preserves_retry_budgets_and_committed_work", () =>
	withSupervisor(({ harness, admission, supervisor }) =>
		Effect.gen(function* () {
			const victimPrincipal = makePrincipal([], `recovery-victim-${crypto.randomUUID()}`);
			const victimExecutionId = crypto.randomUUID();
			const pinHash = sha256Hex(moduleSource);
			const victimInput = {
				marker: "collateral-victim",
				journal: { committedHostResult: "committed-host-operation" },
			};
			const victimFiber = yield* startRun(supervisor, harness, [], {
				pinHash,
				principal: victimPrincipal,
				executionId: victimExecutionId,
				prepare: makePrepare(harness, victimInput),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			let connection = getConnection(harness, "user/core");
			let victimRun = yield* Queue.take(connection.nextRun);
			let finalFailureAt = 0;
			expect(victimRun.input).toEqual(victimInput);

			const startCulprit = (generation: RecordedConnection, index: number) =>
				Effect.gen(function* () {
					const principal = makePrincipal([], `collateral-culprit-${index}`);
					const fiber = yield* startRun(supervisor, harness, [], {
						principal,
						prepare: makePrepare(harness, { marker: `culprit-${index}` }),
					}).pipe(Effect.forkScoped({ startImmediately: true }));
					const run = yield* Queue.take(generation.nextRun);
					return { run, fiber, principal };
				});
			let culprit = yield* startCulprit(connection, 1);
			yield* harness.emit(connection.generation, committedHostCall(victimRun, 1));
			const committedReply = yield* Queue.take(connection.nextHostResult);
			expect(committedReply).toMatchObject({
				type: "hostResult",
				handle: victimRun.handle,
				result: { status: "success" },
			});
			expect(harness.hostDispatches).toHaveLength(1);

			for (const index of [0, 1, 2, 3]) {
				const failureAt = yield* Clock.currentTimeMillis;
				yield* harness.emit(connection.generation, {
					type: "fatal",
					handle: culprit.run.handle,
					reason: "termination-ignored",
					generation: connection.generation,
				});
				yield* Deferred.await(connection.exitConfirmed);
				const culpritFailure = yield* Effect.flip(Fiber.join(culprit.fiber));
				expect(culpritFailure).toMatchObject({ kind: "script-failure" });
				expect(harness.protectionEvents.filter((event) => event.type === "strike")).toHaveLength(
					index + 1,
				);
				expect(harness.hostDispatches).toHaveLength(1);

				const collateral = yield* awaitRecoveryCall(
					harness,
					(call) =>
						call.executionId === victimExecutionId &&
						call.instance === "user/core" &&
						call.pinHash === pinHash &&
						call.operation === "collateral" &&
						call.recoveries === Math.min(index + 1, 3) &&
						call.suspended === (index === 3),
				);
				expect(collateral.suspended).toBe(index === 3);
				if (index === 3) {
					finalFailureAt = failureAt;
					const victimFailure = yield* Effect.flip(Fiber.join(victimFiber));
					expect(victimFailure).toMatchObject({
						instance: "user/core",
						_tag: "SidecarRecoverySuspended",
					});
					break;
				}

				if (index === 0) {
					yield* TestClock.adjust("1 second");
				}
				if (index === 1) {
					yield* TestClock.adjust("2 seconds");
				}
				if (index === 2) {
					yield* TestClock.adjust("4 seconds");
				}
				connection = yield* awaitConnection(harness, "user/core", connection.generation);
				expect(connection.connectedAt - failureAt).toBe([1_000, 2_000, 4_000][index]);
				victimRun = yield* Queue.take(connection.nextRun);
				expect(victimRun.input).toEqual(victimInput);
				expect(victimRun.module).toEqual({ sha256: pinHash, source: moduleSource });
				culprit = yield* startCulprit(connection, index + 2);
			}

			expect(
				harness.recoveryCalls.filter(
					(call) => call.executionId === victimExecutionId && call.operation === "collateral",
				),
			).toHaveLength(4);
			expect(
				harness.recoveryCalls
					.filter(
						(call) => call.executionId === victimExecutionId && call.operation === "collateral",
					)
					.map((call) => [call.recoveries, call.suspended]),
			).toEqual([
				[1, false],
				[2, false],
				[3, false],
				[3, true],
			]);
			expect(admission.snapshot().runs).toBe(0);
			const victimInputsBeforeHealth = harness.prepareInputs
				.filter((prepared) => inputMarker(prepared.input) === "collateral-victim")
				.map((prepared) => prepared.input);
			expect(victimInputsBeforeHealth).toEqual(Array.from({ length: 4 }, () => victimInput));
			expect(harness.hostDispatches).toHaveLength(1);

			const suspendedLeaseAcquired = yield* Deferred.make<void>();
			const suspendedFiber = yield* startRun(supervisor, harness, [], {
				pinHash,
				principal: victimPrincipal,
				executionId: victimExecutionId,
				leaseAcquired: suspendedLeaseAcquired,
				prepare: makePrepare(harness, victimInput),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			yield* Deferred.await(suspendedLeaseAcquired);
			yield* awaitRecoveryCall(
				harness,
				(call) =>
					call.executionId === victimExecutionId && call.operation === "read" && call.suspended,
			);
			yield* TestClock.adjust("8 seconds");
			const healthyConnection = yield* awaitConnection(harness, "user/core", connection.generation);
			expect(healthyConnection.connectedAt - finalFailureAt).toBe(8000);
			const stillSuspended = yield* Effect.flip(Fiber.join(suspendedFiber));
			expect(stillSuspended).toMatchObject({ _tag: "SidecarRecoverySuspended" });
			expect(sentRunFrames(healthyConnection)).toEqual([]);
			expect(
				harness.recoveryCalls.filter(
					(call) => call.executionId === victimExecutionId && call.operation === "resume",
				),
			).toHaveLength(0);

			const replayBeforeHealth = yield* startRun(supervisor, harness, [], {
				pinHash,
				principal: victimPrincipal,
				executionId: victimExecutionId,
				prepare: makePrepare(harness, victimInput),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			const stillSuspendedAgain = yield* Effect.flip(Fiber.join(replayBeforeHealth));
			expect(stillSuspendedAgain).toMatchObject({ _tag: "SidecarRecoverySuspended" });
			expect(sentRunFrames(healthyConnection)).toEqual([]);

			yield* TestClock.adjust("60 seconds");
			const resumedFiber = yield* startRun(supervisor, harness, [], {
				pinHash,
				principal: victimPrincipal,
				executionId: victimExecutionId,
				prepare: makePrepare(harness, victimInput),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			const resumedState = yield* awaitRecoveryCall(
				harness,
				(call) => call.executionId === victimExecutionId && call.operation === "resume",
			);
			expect(resumedState).toMatchObject({ recoveries: 3, suspended: false });
			expect(resumedState.healthyEpoch).toBeTruthy();
			const resumedRun = yield* Queue.take(healthyConnection.nextRun);
			expect(resumedRun.input).toEqual(victimInput);
			expect(resumedRun.module).toEqual({ sha256: pinHash, source: moduleSource });
			yield* harness.complete(healthyConnection, resumedRun);
			const completed = yield* Fiber.join(resumedFiber);
			expect(completed.recovery).toEqual({
				pinHash,
				instance: "user/core",
				executionId: victimExecutionId,
			});
			const victimInputs = harness.prepareInputs
				.filter(
					(prepared) =>
						typeof prepared.input === "object" &&
						prepared.input !== null &&
						Reflect.get(prepared.input, "marker") === "collateral-victim",
				)
				.map((prepared) => prepared.input);
			expect(victimInputs).toEqual(Array.from({ length: 5 }, () => victimInput));
			expect(harness.hostDispatches).toHaveLength(1);
		}),
	),
);

supervisorTest("global_admission_bounds_all_tiers_grants_and_recovery", () =>
	withSupervisor(({ harness, admission, supervisor }) =>
		Effect.gen(function* () {
			const completed = new Set<string>();
			const outstanding = () =>
				harness.connections.flatMap(sentRunFrames).filter((run) => !completed.has(run.handle))
					.length;
			const finish = (connection: RecordedConnection, run: RunFrame) =>
				harness.complete(connection, run).pipe(
					Effect.andThen(
						Effect.sync(() => {
							completed.add(run.handle);
						}),
					),
				);
			const granted = makePrincipal(dataRuntimeImports, "user-granted-data");
			const grantedFiber = yield* startRun(supervisor, harness, [], {
				principal: {
					...granted,
					metadata: { ...granted.metadata, capabilities: ["artifact-read", "scratch"] },
				},
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			const data = yield* awaitConnection(harness, "user/data");
			const grantedRun = yield* Queue.take(data.nextRun);
			const fullFiber = yield* startRun(supervisor, harness, [], {
				principal: makePrincipal(["@ryot-app/sandbox-sdk/youtubei"], "system-full"),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			const full = yield* awaitConnection(harness, "system/full");
			const fullRun = yield* Queue.take(full.nextRun);
			expect(outstanding()).toBe(2);

			const userCoreAdmitted = yield* Deferred.make<void>();
			const systemCoreAdmitted = yield* Deferred.make<void>();
			const userCoreFiber = yield* startRun(supervisor, harness, [], {
				leaseAcquired: userCoreAdmitted,
				principal: makePrincipal([], "user-core"),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			const systemCoreFiber = yield* startRun(supervisor, harness, [], {
				leaseAcquired: systemCoreAdmitted,
				principal: makePrincipal([], "system-core"),
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			yield* Effect.yieldNow;
			expect(admission.snapshot()).toMatchObject({ runs: 2, waiting: 2 });
			const overflow = yield* Effect.flip(
				Effect.scoped(supervisor.reserve(makePrincipal([], "user-overflow"), false)),
			);
			expect(overflow.kind).toBe("resource-unavailable");
			expect(overflow.message).toBe("Sandbox ephemeral admission queue is full");

			yield* harness.emit(data.generation, {
				type: "fatal",
				generation: data.generation,
				reason: "termination-ignored",
				handle: "unregistered-crash-handle",
			});
			yield* Deferred.await(data.exitConfirmed);
			completed.add(grantedRun.handle);
			yield* TestClock.adjust("1 second");
			const probeConnection = yield* awaitConnection(harness, "user/data", data.generation);
			const probe = yield* Queue.take(probeConnection.nextRun);
			expect(outstanding()).toBe(2);
			expect(admission.snapshot()).toMatchObject({ runs: 2, waiting: 2 });
			expect(yield* Deferred.isDone(userCoreAdmitted)).toBe(false);
			expect(yield* Deferred.isDone(systemCoreAdmitted)).toBe(false);

			yield* finish(probeConnection, probe);
			yield* Fiber.join(grantedFiber);
			yield* Deferred.await(userCoreAdmitted);
			const userCore = getConnection(harness, "user/core");
			const userCoreRun = yield* Queue.take(userCore.nextRun);
			expect(outstanding()).toBe(2);
			expect(yield* Deferred.isDone(systemCoreAdmitted)).toBe(false);

			yield* finish(full, fullRun);
			yield* Fiber.join(fullFiber);
			yield* Deferred.await(systemCoreAdmitted);
			const systemCore = getConnection(harness, "system/core");
			const systemCoreRun = yield* Queue.take(systemCore.nextRun);
			expect(outstanding()).toBe(2);

			yield* finish(userCore, userCoreRun);
			yield* finish(systemCore, systemCoreRun);
			yield* Fiber.join(userCoreFiber);
			yield* Fiber.join(systemCoreFiber);
			expect(outstanding()).toBe(0);
			expect(supervisor.snapshot().maxActiveExecutions).toBe(2);
		}),
	).pipe(
		Effect.provideService(SandboxExecutionAuthority, {
			resolve: (principal: SandboxExecutionPrincipal) =>
				Effect.succeed(principal.scriptSlug.startsWith("system-") ? "system" : "user"),
		}),
	),
);

const inlineBatch = (run: RunFrame, seq: number, index: number) =>
	Schema.decodeSync(SidecarHostCallFrame)({
		seq,
		type: "hostCall",
		handle: run.handle,
		name: "inlineBatch",
		generation: run.generation,
		args: {
			requests: [
				{
					index,
					kind: "host",
					name: "getCachedValue",
					args: { args: ["key"], capability: "getCachedValue" },
				},
			],
		},
	});

supervisorTest("inline_settlement_pauses_only_script_time_with_ceilings_and_backstop", () =>
	withSupervisor(({ harness, supervisor }) =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate.make;
			const parentSpan = yield* Effect.currentSpan;
			const releaseOrdinary = yield* Deferred.make<void>();
			const settlements = yield* Queue.unbounded<Deferred.Deferred<void>>();
			const registrations: Array<SandboxHostCallGateRegistration> = [];
			const input: SandboxRunInput = {
				context: {},
				compiledFormat: 1,
				replayJournal: [],
				compiledCode: moduleSource,
				executionId: "inline-budget",
				workflowExecutionId: "inline-budget-workflow",
				principal: {
					...makePrincipal([], "inline-budget"),
					metadata: { kind: "workflow", runtimeImports: [], capabilities: ["getCachedValue"] },
				},
				inlineDurableHost: {
					capabilities: ["getCachedValue"],
					settle: (requests) =>
						Effect.gen(function* () {
							const release = yield* Deferred.make<void>();
							yield* Queue.offer(settlements, release);
							yield* Deferred.await(release);
							return requests.map(() => ({ value: null, state: "success" as const }));
						}),
				},
			};
			const prepare: SandboxSidecarRun["prepare"] = (identity) =>
				Effect.gen(function* () {
					const registration = yield* gate
						.register({
							...identity,
							input,
							parentSpan,
							apiFunctions: {
								getCachedValue: () =>
									Deferred.await(releaseOrdinary).pipe(Effect.as(hostSuccess(null))),
							},
							files: {
								harvest: () => Effect.succeed(null),
								scratchWrite: () => Effect.die("Unexpected scratch write"),
								artifactReadRange: () => Effect.die("Unexpected artifact read"),
								filesystem: { scratch: false, artifact: false, namedArtifacts: [] },
							},
						})
						.pipe(Effect.orDie);
					registrations.push(registration);
					return {
						input: null,
						gate: registration,
						finish: () => Effect.void,
						module: { source: moduleSource, sha256: sha256Hex(moduleSource) },
					};
				});
			const runFiber = yield* startRun(supervisor, harness, [], {
				prepare,
				principal: input.principal,
			}).pipe(Effect.forkScoped({ startImmediately: true }));
			const connection = getConnection(harness, "user/core");
			const run = yield* Queue.take(connection.nextRun);
			const registration = registrations[0];
			assert(registration !== undefined);
			expect(run.limits.deadlineMs).toBe(30_000);

			const ordinaryCall = yield* Schema.decodeEffect(SidecarHostCallFrame)({
				seq: 1,
				type: "hostCall",
				handle: run.handle,
				name: "getCachedValue",
				args: { args: ["key"] },
				generation: run.generation,
			});
			yield* harness.emit(run.generation, ordinaryCall);
			yield* TestClock.adjust("4 seconds");
			expect(yield* registration.scriptBudget).toEqual({ settledMs: 0, remainingMs: 26_000 });
			yield* Deferred.succeed(releaseOrdinary, undefined);
			expect(yield* Queue.take(connection.nextHostResult)).toMatchObject({ seq: 1 });

			yield* harness.emit(run.generation, inlineBatch(run, 2, 0));
			const firstSettlement = yield* Queue.take(settlements);
			yield* TestClock.adjust("5 seconds");
			expect(yield* registration.scriptBudget).toEqual({ settledMs: 0, remainingMs: 26_000 });
			yield* Deferred.succeed(firstSettlement, undefined);
			expect(yield* Queue.take(connection.nextHostResult)).toMatchObject({
				seq: 2,
				result: { status: "success", value: { results: [{ value: null, state: "success" }] } },
			});
			expect(yield* registration.scriptBudget).toEqual({ settledMs: 5_000, remainingMs: 26_000 });

			yield* harness.emit(run.generation, inlineBatch(run, 3, 1));
			yield* Queue.take(settlements);
			yield* TestClock.adjust("30 seconds");
			expect(yield* Queue.take(connection.nextHostResult)).toMatchObject({
				seq: 3,
				result: { status: "success", value: { defer: true } },
			});
			expect(yield* registration.scriptBudget).toEqual({ settledMs: 35_000, remainingMs: 26_000 });

			for (let index = 0; index < 8; index++) {
				yield* harness.emit(run.generation, inlineBatch(run, 4 + index, 1 + index));
				const settlement = yield* Queue.take(settlements);
				yield* TestClock.adjust("29 seconds");
				yield* Deferred.succeed(settlement, undefined);
				expect(yield* Queue.take(connection.nextHostResult)).toMatchObject({ seq: 4 + index });
			}
			expect(yield* registration.scriptBudget).toEqual({ settledMs: 267_000, remainingMs: 26_000 });
			yield* harness.emit(run.generation, inlineBatch(run, 12, 9));
			const lastSettlement = yield* Queue.take(settlements);
			yield* TestClock.adjust("28 seconds");
			yield* Deferred.succeed(lastSettlement, undefined);
			expect(yield* Queue.take(connection.nextHostResult)).toMatchObject({ seq: 12 });
			expect(connection.sent.filter((frame) => frame.type === "cancel")).toEqual([]);
			yield* TestClock.adjust("1 second");
			expect(yield* Queue.take(connection.nextCancel)).toMatchObject({ handle: run.handle });
			expect(yield* registration.scriptBudget).toEqual({ settledMs: 295_000, remainingMs: 25_000 });
			yield* harness.emit(run.generation, {
				seq: 0,
				type: "done",
				handle: run.handle,
				generation: run.generation,
				outcome: { status: "cancelled" },
				console: { entries: [], truncated: false },
			});
			expect((yield* Fiber.join(runFiber)).done.outcome).toEqual({ status: "cancelled" });
			expect(connection.finalized).toBe(false);
		}),
	).pipe(Effect.withSpan("sandbox.supervisor.inline-budget-test")),
);

const owned = (owner: string, scriptSlug: string): SandboxExecutionPrincipal => ({
	...makePrincipal([], scriptSlug),
	standaloneUploaderId: UserId.make(owner),
});

supervisorTest("per_user_sidecars_shard_the_user_tier_by_owner", () =>
	Effect.gen(function* () {
		const config = yield* AppConfig;
		yield* withSupervisor(({ harness, supervisor }) =>
			Effect.gen(function* () {
				expect(yield* supervisor.locate(owned("alice", "alice-script"))).toMatchObject({
					tier: "core",
					trust: "user",
					instance: "user/core/alice",
				});
				expect(yield* supervisor.locate(makePrincipal([], "system-script"))).toMatchObject({
					instance: "system/core",
				});
				const shared = getConnection(harness, "user/core");
				const aliceFiber = yield* startRun(supervisor, harness, [], {
					principal: owned("alice", "alice-script"),
				}).pipe(Effect.forkScoped({ startImmediately: true }));
				const alice = yield* awaitConnection(harness, "user/core", shared.generation);
				const aliceRun = yield* Queue.take(alice.nextRun);
				const bobFiber = yield* startRun(supervisor, harness, [], {
					principal: owned("bob", "bob-script"),
				}).pipe(Effect.forkScoped({ startImmediately: true }));
				const bob = yield* awaitConnection(harness, "user/core", alice.generation);
				const bobRun = yield* Queue.take(bob.nextRun);
				expect(harness.connections).toHaveLength(4);
				expect(shared.sent).toEqual([]);
				expect([alice.settings, bob.settings]).toMatchObject([
					{ tier: "core", trust: "user" },
					{ tier: "core", trust: "user" },
				]);
				expect(alice.generation).not.toBe(bob.generation);
				yield* harness.complete(alice, aliceRun);
				yield* harness.complete(bob, bobRun);
				yield* Fiber.join(aliceFiber);
				yield* Fiber.join(bobFiber);
				yield* TestClock.adjust("61 seconds");
				yield* Deferred.await(alice.exitConfirmed);
				yield* Deferred.await(bob.exitConfirmed);
				expect(shared.finalized).toBe(false);
			}),
		).pipe(
			Effect.provideService(SandboxExecutionAuthority, {
				resolve: (principal: SandboxExecutionPrincipal) =>
					Effect.succeed(principal.scriptSlug.startsWith("system-") ? "system" : "user"),
			}),
			Effect.provideService(AppConfig, {
				...config,
				sandbox: { ...config.sandbox, perUserSidecars: true },
			}),
		);
	}),
);
