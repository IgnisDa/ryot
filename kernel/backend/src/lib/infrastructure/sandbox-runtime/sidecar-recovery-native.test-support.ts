import { BunServices } from "@effect/platform-bun";
import { assert } from "@effect/vitest";
import { sandboxCompilerPlatformLayer } from "@ryot-app/sandbox-compiler/platform";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { AppConfig } from "#lib/infrastructure/config/service";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { SandboxCrashStore } from "#lib/infrastructure/sandbox-crash-store";
import { SandboxRecoveryStore } from "#lib/infrastructure/sandbox-recovery-store";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { testRedisUrl } from "#lib/test-utils/redis";
import { sandboxRuntimeDirectory } from "#lib/test-utils/sandbox-runtime";
import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { SandboxExecutionAuthority } from "./execution-principal";
import { SandboxFileService } from "./file-service";
import { SandboxHostCallGate } from "./host-call-gate";
import { SandboxHostImplementations } from "./host-implementations";
import {
	makeRunnerInput,
	type RunnerCompiled,
	type RunnerOptions,
} from "./runner-native.test-support";
import { SandboxService } from "./service";
import type { SandboxRunInput } from "./shared";
import { SandboxSidecarAdmission } from "./sidecar-admission";
import { SandboxSidecarClient } from "./sidecar-client";
import type { SidecarInboundFrame } from "./sidecar-protocol";
import { SandboxSidecarQuarantine } from "./sidecar-quarantine";
import { SandboxSidecarSupervisor } from "./sidecar-supervisor";

type Connection = Effect.Success<ReturnType<SandboxSidecarClient["Service"]["connect"]>>;
type Event = Effect.Success<Connection["next"]>;
type NativeConnectionEvidence = {
	readonly connection: Connection;
	readonly generation: number;
	readonly instance: string;
};
type NativeFrameEvidence = {
	readonly frame: Event | SidecarInboundFrame;
	readonly instance: string;
};

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const killNativeConnection = Effect.fnUntraced(function* (connection: Connection) {
	assert(connection.pid !== undefined);
	if (process.platform === "linux") {
		const config = yield* AppConfig;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const killer = yield* spawner.spawn(
			ChildProcess.make(config.sandbox.launcherPath, ["terminate", String(connection.pid)], {
				env: {},
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
			}),
		);
		assert(
			Number(yield* killer.exitCode) === 0,
			"Canonical launcher rejected native test termination",
		);
	} else {
		process.kill(connection.pid, "SIGKILL");
	}
	return yield* connection.exit;
});

const unused = () => Effect.die("Unexpected native recovery host dispatch");
const unusedValue = (): never => {
	throw new Error("Unexpected native recovery lifecycle value");
};
const lifecycleSteps = {
	commit: unused,
	prepare: unused,
	validate: unused,
	value: unusedValue,
	applyPolicies: unused,
};
const hosts = Layer.succeed(SandboxHostImplementations, {
	automation: { emitSignal: unused, sendNotification: unused },
	runtime: {
		httpCall: unused,
		setCachedValue: unused,
		getCachedValue: unused,
		getPersistentValue: unused,
		claimPersistentValue: unused,
	},
	lifecycle: {
		upsertGlobalEntities: lifecycleSteps,
		changeUserRelationships: lifecycleSteps,
		upsertGlobalRelationships: lifecycleSteps,
		updateEvents: { commit: unused, validate: unused },
		deleteEvents: { commit: unused, validate: unused },
	},
	additional: {
		deleteEvents: unused,
		createEvents: unused,
		updateEvents: unused,
		executeRyotql: unused,
		getPluginConfig: unused,
		getUserSettings: unused,
		listIntegrations: unused,
		listEventSchemas: unused,
		getEntitySchemas: unused,
		getUserPreferences: unused,
		ensureUserEntities: unused,
		getOAuthAccessToken: unused,
		upsertGlobalEntities: unused,
		getCurrentIntegration: unused,
		requestEventStreamWork: unused,
		changeUserRelationships: unused,
		upsertGlobalRelationships: unused,
	},
});

const files = Layer.succeed(SandboxFileService, {
	open: () =>
		Effect.succeed({
			scratchWrite: unused,
			artifactReadRange: unused,
			harvest: () => Effect.succeed(null),
			filesystem: { scratch: false, artifact: false, namedArtifacts: [] },
		}),
});

export class NativeRecoveryEvidence extends Context.Service<
	NativeRecoveryEvidence,
	{
		readonly sent: NativeFrameEvidence[];
		readonly received: NativeFrameEvidence[];
		readonly connections: NativeConnectionEvidence[];
		readonly timeline: Array<{
			readonly direction: "sent" | "received";
			readonly frame: Event | SidecarInboundFrame;
			readonly instance: string;
		}>;
	}
>()("test/NativeRecoveryEvidence") {}

const recordingClient = Layer.effect(
	SandboxSidecarClient,
	Effect.gen(function* () {
		const real = yield* SandboxSidecarClient;
		const evidence = yield* NativeRecoveryEvidence;
		return {
			connect: Effect.fnUntraced(function* (settings: Parameters<typeof real.connect>[0]) {
				const connection = yield* real.connect(settings);
				const instance = `${settings.trust}/${settings.tier}`;
				evidence.connections.push({ instance, connection, generation: connection.generation });
				return {
					...connection,
					next: connection.next.pipe(
						Effect.tap((frame) =>
							Effect.sync(() => {
								const record = { frame, instance };
								evidence.received.push(record);
								evidence.timeline.push({ ...record, direction: "received" });
							}),
						),
					),
					send: (frame: SidecarInboundFrame) => {
						const record = { frame, instance };
						evidence.sent.push(record);
						evidence.timeline.push({ ...record, direction: "sent" });
						// Only the native allocation probe receives tighter wire limits; process flags and policy stay real.
						return connection.send(
							frame.type === "run" && frame.module.source.includes("2 ** 32 - 1")
								? {
										...frame,
										limits: {
											cpuMs: 500,
											deadlineMs: 5000,
											heapBytes: 32 * 1024 * 1024,
											externalBytes: 16 * 1024 * 1024,
										},
									}
								: frame,
						);
					},
				};
			}),
		};
	}),
).pipe(Layer.provide(SandboxSidecarClient.layer));

export const nativeRecoveryLayer = Layer.unwrap(
	Effect.gen(function* () {
		const runtimeDirectory = yield* sandboxRuntimeDirectory;
		const config = makeAppConfigLayer({
			redisUrl: Redacted.make(testRedisUrl()),
			sandbox: { runtimeDirectory, memoryBudgetMiB: 2048 },
		});
		return Layer.mergeAll(
			hosts,
			files,
			recordingClient,
			SandboxCompiler.layer,
			SandboxHostCallGate.layer,
			SandboxSidecarAdmission.layer,
			SandboxRecoveryStore.layer,
			SandboxSidecarQuarantine.layer,
			SandboxCrashStore.layer,
			Layer.succeed(SandboxExecutionAuthority, {
				resolve: (principal) =>
					Effect.succeed(
						principal.standaloneUploaderId === undefined && principal.pluginRevision === null
							? "system"
							: "user",
					),
			}),
		).pipe(
			Layer.provideMerge(RedisService.layer),
			Layer.provideMerge(
				Layer.effect(
					NativeRecoveryEvidence,
					Effect.sync(() => ({ sent: [], received: [], timeline: [], connections: [] })),
				),
			),
			Layer.provideMerge(config),
		);
	}),
).pipe(Layer.provideMerge(Layer.mergeAll(BunServices.layer, sandboxCompilerPlatformLayer)));

export const nativeInput = (
	compiled: RunnerCompiled,
	executionId: string,
	context: unknown = {},
	options: RunnerOptions = {},
) => makeRunnerInput(compiled, context, { ...options, executionId });

export const runSupervisedNative = Effect.fnUntraced(function* (
	supervisor: SandboxSidecarSupervisor["Service"],
	input: SandboxRunInput,
) {
	const service = yield* SandboxService.make.pipe(
		Effect.provideService(SandboxSidecarSupervisor, supervisor),
	);
	return yield* service.run(input);
});

export const trackNativeKeys = Effect.gen(function* () {
	const redis = yield* RedisService;
	const quarantine = yield* SandboxSidecarQuarantine;
	const identities = new Set<string>();
	const executionIds = new Set<string>();
	const tracked = new Map<string, ReadonlyArray<string>>();
	yield* Effect.addFinalizer(() =>
		executionIds.size === 0 && identities.size === 0
			? Effect.void
			: redis.del(
					...[...executionIds].map(redisKeys.sandboxRecovery),
					...[...identities].flatMap((identity) => [
						redisKeys.sandboxCrashWindow(identity),
						redisKeys.sandboxQuarantine(identity),
						redisKeys.sandboxProbation(identity),
						redisKeys.sandboxProbationLease(identity),
					]),
				),
	);
	return Effect.fnUntraced(function* (input: SandboxRunInput, trust: "user" | "system" = "user") {
		executionIds.add(input.executionId);
		const key = encodeJson([trust, input.principal]);
		const existing = tracked.get(key);
		if (existing !== undefined) {
			return existing;
		}
		const protection = yield* quarantine.open(input.principal, trust);
		for (const identity of protection.identities) {
			identities.add(identity);
		}
		tracked.set(key, protection.identities);
		return protection.identities;
	});
});
