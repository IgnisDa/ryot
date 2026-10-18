import { assert } from "@effect/vitest";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Context, Effect, Layer, Option, Queue } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { MiB } from "../protocol/limits";
import type { SidecarInboundFrame } from "../protocol/messages";
import { SandboxSidecarAdmission } from "./admission";
import { SandboxExecutionAuthority } from "./authority";
import type { SandboxSidecarClient } from "./client";
import { SANDBOX_LAUNCHER_PATH } from "./client";
import { compileTestScript } from "./compile.test-support";
import { SandboxCrashStore, sandboxProtectionKeys } from "./crash-store";
import { SandboxExecutor } from "./executor";
import { ExecutionFiles } from "./file-access";
import { encodeJson } from "./host-call-args.test-support";
import { SandboxHostCallGate } from "./host-call-gate";
import { SandboxHostFunctions } from "./host-functions";
import {
	deleteRedisKeysOnExit,
	makeSandboxHostConfigLayer,
	testSandboxRedisLayer,
	unusedSandboxHostFunctions,
} from "./host.test-support";
import type { SandboxRunInput } from "./invocation";
import { SandboxSidecarQuarantine } from "./quarantine";
import { SandboxRecoveryStore } from "./recovery-store";
import { sandboxRedisKeys } from "./redis";
import {
	makeRunnerInput,
	nativePlatformLayer,
	recordingSidecarClient,
	type RunnerCompiled,
	type RunnerOptions,
} from "./runner-native.test-support";
import { SandboxSidecarSupervisor } from "./supervisor";

type Event = Effect.Success<Connection["next"]>;
type Connection = Effect.Success<ReturnType<SandboxSidecarClient["Service"]["connect"]>>;
type NativeFrameEvidence = {
	readonly instance: string;
	readonly frame: Event | SidecarInboundFrame;
};
type NativeConnectionEvidence = {
	readonly instance: string;
	readonly generation: number;
	readonly connection: Connection;
};

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

const hosts = Layer.succeed(SandboxHostFunctions, unusedSandboxHostFunctions());

const unused = () => Effect.die("Unexpected native recovery host dispatch");
const tightenedMemoryLimits = { heapBytes: 32 * MiB, externalBytes: 16 * MiB };

const files = Layer.succeed(ExecutionFiles, {
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
		readonly sentSignal: Queue.Queue<void>;
		readonly tightenedModules: Set<string>;
		readonly received: NativeFrameEvidence[];
		readonly connections: NativeConnectionEvidence[];
		readonly timeline: Array<{
			readonly instance: string;
			readonly direction: "sent" | "received";
			readonly frame: Event | SidecarInboundFrame;
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
			Queue.offerUnsafe(evidence.sentSignal, undefined);
			evidence.timeline.push({ ...record, direction: "sent" });
			return frame.type === "run" && evidence.tightenedModules.has(frame.module.sha256)
				? { ...frame, limits: { ...frame.limits, ...tightenedMemoryLimits } }
				: frame;
		},
	})),
);

export const nativeRecoveryLayer = Layer.mergeAll(
	hosts,
	files,
	recordingClient,
	ViteBuildService.layer,
	SandboxHostCallGate.layer.pipe(Layer.provideMerge(SandboxSidecarAdmission.layer)),
	SandboxRecoveryStore.layer,
	SandboxSidecarQuarantine.layer,
	SandboxCrashStore.layer,
	Layer.succeed(SandboxExecutionAuthority, {
		resolve: (principal) => Effect.succeed(principal.pluginRevision === null ? "system" : "user"),
	}),
).pipe(
	Layer.provideMerge(testSandboxRedisLayer),
	Layer.provideMerge(
		Layer.effect(
			NativeRecoveryEvidence,
			Effect.gen(function* () {
				return {
					sent: [],
					received: [],
					timeline: [],
					connections: [],
					tightenedModules: new Set<string>(),
					sentSignal: yield* Queue.unbounded<void>(),
				};
			}),
		),
	),
	Layer.provideMerge(makeSandboxHostConfigLayer({ memoryBudgetMiB: Option.some(2048) })),
	Layer.provideMerge(nativePlatformLayer),
);

export const awaitSent = Effect.fnUntraced(function* (
	evidence: NativeRecoveryEvidence["Service"],
	predicate: () => boolean,
) {
	while (!predicate()) {
		yield* Queue.take(evidence.sentSignal);
	}
});

export const compileTightenedNative = Effect.fnUntraced(function* (source: string) {
	const compiled = yield* compileTestScript(source);
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
	const service = yield* SandboxExecutor.make.pipe(
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
		...[...executionIds].map(sandboxRedisKeys.recovery),
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
