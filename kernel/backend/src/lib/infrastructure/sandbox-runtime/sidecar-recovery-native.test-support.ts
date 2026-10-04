import { assert } from "@effect/vitest";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { SandboxCrashStore } from "#lib/infrastructure/sandbox-crash-store";
import { SandboxRecoveryStore } from "#lib/infrastructure/sandbox-recovery-store";
import { deleteRedisKeysOnExit, sandboxProtectionKeys, testRedisUrl } from "#lib/test-utils/redis";
import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { SandboxExecutionAuthority } from "./execution-principal";
import { SandboxFileService } from "./file-service";
import { SandboxHostCallGate } from "./host-call-gate";
import { SandboxHostImplementations } from "./host-implementations";
import { MiB } from "./limits";
import {
	makeRunnerInput,
	nativeConfigLayer,
	nativePlatformLayer,
	recordingSidecarClient,
	unusedSandboxHostImplementations,
	type RunnerCompiled,
	type RunnerOptions,
} from "./runner-native.test-support";
import { SandboxService } from "./service";
import type { SandboxRunInput } from "./shared";
import { SandboxSidecarAdmission } from "./sidecar-admission";
import type { SandboxSidecarClient } from "./sidecar-client";
import { SANDBOX_LAUNCHER_PATH } from "./sidecar-client";
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
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const killer = yield* spawner.spawn(
			ChildProcess.make(SANDBOX_LAUNCHER_PATH, ["terminate", String(connection.pid)], {
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

const hosts = Layer.succeed(SandboxHostImplementations, unusedSandboxHostImplementations());

const unused = () => Effect.die("Unexpected native recovery host dispatch");
const tightenedRunLimits = {
	cpuMs: 500,
	deadlineMs: 5000,
	heapBytes: 32 * MiB,
	externalBytes: 16 * MiB,
};

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
		readonly tightenedModules: Set<string>;
		readonly timeline: Array<{
			readonly direction: "sent" | "received";
			readonly frame: Event | SidecarInboundFrame;
			readonly instance: string;
		}>;
	}
>()("test/NativeRecoveryEvidence") {}

const recordingClient = recordingSidecarClient(
	Effect.map(NativeRecoveryEvidence, (evidence) => ({
		connected: (settings, connection) => {
			evidence.connections.push({
				connection,
				generation: connection.generation,
				instance: `${settings.trust}/${settings.tier}`,
			});
		},
		received: (frame, settings) => {
			const record = { frame, instance: `${settings.trust}/${settings.tier}` };
			evidence.received.push(record);
			evidence.timeline.push({ ...record, direction: "received" });
		},
		sent: (frame, settings) => {
			const record = { frame, instance: `${settings.trust}/${settings.tier}` };
			evidence.sent.push(record);
			evidence.timeline.push({ ...record, direction: "sent" });
			return frame.type === "run" && evidence.tightenedModules.has(frame.module.sha256)
				? { ...frame, limits: tightenedRunLimits }
				: frame;
		},
	})),
);

export const nativeRecoveryLayer = Layer.mergeAll(
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
		resolve: (principal) => Effect.succeed(principal.pluginRevision === null ? "system" : "user"),
	}),
).pipe(
	Layer.provideMerge(RedisService.layer),
	Layer.provideMerge(
		Layer.effect(
			NativeRecoveryEvidence,
			Effect.sync(() => ({
				sent: [],
				received: [],
				timeline: [],
				connections: [],
				tightenedModules: new Set<string>(),
			})),
		),
	),
	Layer.provideMerge(
		nativeConfigLayer({
			redisUrl: Redacted.make(testRedisUrl()),
			sandbox: { memoryBudgetMiB: Option.some(2048) },
		}),
	),
	Layer.provideMerge(nativePlatformLayer),
);

export const compileTightenedNative = Effect.fnUntraced(function* (source: string) {
	const compiled = yield* (yield* SandboxCompiler).compile(source);
	(yield* NativeRecoveryEvidence).tightenedModules.add(sha256Hex(compiled.javascript));
	return compiled;
});

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
	const quarantine = yield* SandboxSidecarQuarantine;
	const identities = new Set<string>();
	const executionIds = new Set<string>();
	const tracked = new Map<string, ReadonlyArray<string>>();
	yield* deleteRedisKeysOnExit(() => [
		...[...executionIds].map(redisKeys.sandboxRecovery),
		...[...identities].flatMap(sandboxProtectionKeys),
	]);
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
