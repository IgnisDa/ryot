import type { FileSystem } from "effect";
import { Context, Data, Effect, Layer, Option } from "effect";

import { AppConfig } from "../config/service";

export type SandboxProfileArm = {
	readonly token: string;
	readonly executions: number;
	readonly scriptSlug: string;
	readonly cpuProfile: boolean;
	readonly maxAttemptsPerExecution: number;
	readonly maxHeapSnapshotsPerAttempt: number;
};

export type SandboxProfileAttemptRecord = {
	pid: number;
	finished: boolean;
	checkpointCount: number;
	error: string | null;
	heapSnapshotCount: number;
	readonly attempt: number;
	readonly directory: string;
};

export type SandboxProfileSelection = {
	readonly token: string;
	readonly directory: string;
	readonly cpuProfile: boolean;
	readonly maxHeapSnapshots: number;
	readonly record: SandboxProfileAttemptRecord;
};

type BoundExecution = {
	readonly arm: SandboxProfileArm;
	readonly executionId: string;
	readonly directory: string;
	readonly attempts: SandboxProfileAttemptRecord[];
};

export const makeSandboxProfileRegistry = (root: string) => {
	const pending = new Map<string, { arm: SandboxProfileArm; remaining: number }>();
	const bound = new Map<string, BoundExecution>();
	const boundByToken = new Map<string, BoundExecution[]>();

	const arm = (input: SandboxProfileArm) => {
		pending.set(input.token, { arm: input, remaining: input.executions });
	};

	const select = (input: {
		readonly scriptSlug: string;
		readonly executionKey: string;
	}): SandboxProfileSelection | null => {
		let execution = bound.get(input.executionKey);
		if (execution === undefined) {
			const match = [...pending.values()].find(
				({ remaining, arm: candidate }) =>
					remaining > 0 && candidate.scriptSlug === input.scriptSlug,
			);
			if (match === undefined) {
				return null;
			}
			match.remaining -= 1;
			if (match.remaining === 0) {
				pending.delete(match.arm.token);
			}
			const siblings = boundByToken.get(match.arm.token) ?? [];
			execution = {
				attempts: [],
				arm: match.arm,
				executionId: input.executionKey,
				directory: `${root}/${match.arm.token}/execution-${siblings.length + 1}`,
			};
			siblings.push(execution);
			boundByToken.set(match.arm.token, siblings);
			bound.set(input.executionKey, execution);
		}
		if (execution.attempts.length >= execution.arm.maxAttemptsPerExecution) {
			return null;
		}
		const attempt = execution.attempts.length + 1;
		const record: SandboxProfileAttemptRecord = {
			pid: 0,
			attempt,
			error: null,
			finished: false,
			checkpointCount: 0,
			heapSnapshotCount: 0,
			directory: `${execution.directory}/attempt-${attempt}`,
		};
		execution.attempts.push(record);
		return {
			record,
			token: execution.arm.token,
			directory: record.directory,
			cpuProfile: execution.arm.cpuProfile,
			maxHeapSnapshots: execution.arm.maxHeapSnapshotsPerAttempt,
		};
	};

	const status = (token: string) => ({
		token,
		armed: pending.has(token),
		remainingExecutions: pending.get(token)?.remaining ?? 0,
		executions: (boundByToken.get(token) ?? []).map((execution) => ({
			executionId: execution.executionId,
			attempts: execution.attempts.map((attempt) => ({ ...attempt })),
		})),
	});

	const disarm = () => {
		const disarmed = pending.size;
		pending.clear();
		return disarmed;
	};

	return { arm, select, status, disarm };
};

// Selections are armed through test support and consumed by the sandbox service, which may be
// built from separate layer instances, so the registry is process-wide per profile root.
const registries = new Map<string, ReturnType<typeof makeSandboxProfileRegistry>>();

const sharedRegistry = (root: string) => {
	const existing = registries.get(root);
	if (existing) {
		return existing;
	}
	const created = makeSandboxProfileRegistry(root);
	registries.set(root, created);
	return created;
};

export class SandboxProfilingDisabledError extends Data.TaggedError(
	"SandboxProfilingDisabledError",
)<{ readonly message: string }> {}

export const createRestrictedDirectory = (fs: FileSystem.FileSystem, path: string) =>
	fs
		.makeDirectory(path, { mode: 0o700, recursive: true })
		.pipe(Effect.andThen(fs.chmod(path, 0o700)));

/** Deno writes `--cpu-prof` output with its default mode, so it is tightened after the process exits. */
export const restrictDirectoryFiles = (fs: FileSystem.FileSystem, path: string) =>
	Effect.flatMap(fs.readDirectory(path), (entries) =>
		Effect.forEach(entries, (entry) => fs.chmod(`${path}/${entry}`, 0o600), { discard: true }),
	);

export const appendRestrictedLine = (fs: FileSystem.FileSystem, path: string, line: string) =>
	fs.writeFileString(path, `${line}\n`, { flag: "a", mode: 0o600 });

export class InspectorHeapSnapshotError extends Data.TaggedError("InspectorHeapSnapshotError")<{
	readonly message: string;
}> {}

const isHeapSnapshotChunk = (message: object): message is { params: { chunk: string } } =>
	"method" in message &&
	message.method === "HeapProfiler.addHeapSnapshotChunk" &&
	"params" in message &&
	typeof message.params === "object" &&
	message.params !== null &&
	"chunk" in message.params &&
	typeof message.params.chunk === "string";

/**
 * Streams a heap snapshot from a Deno inspector session into a file created with mode 0600. The
 * profiled runner awaits its checkpoint request meanwhile, so its event loop is idle and serves the
 * inspector session.
 */
export const takeInspectorHeapSnapshot = (
	fs: FileSystem.FileSystem,
	inspectorUrl: string,
	path: string,
) =>
	fs.writeFileString(path, "", { mode: 0o600 }).pipe(
		Effect.andThen(
			Effect.callback<void, InspectorHeapSnapshotError>((resume) => {
				const socket = new WebSocket(inspectorUrl);
				const writer = Bun.file(path).writer();
				const fail = (message: string) => {
					socket.close();
					void Promise.resolve(writer.end()).finally(() =>
						resume(Effect.fail(new InspectorHeapSnapshotError({ message }))),
					);
				};
				socket.addEventListener("open", () => {
					socket.send(JSON.stringify({ id: 1, params: {}, method: "HeapProfiler.enable" }));
					socket.send(
						JSON.stringify({
							id: 2,
							method: "HeapProfiler.takeHeapSnapshot",
							params: { reportProgress: false, captureNumericValue: false },
						}),
					);
				});
				socket.addEventListener("message", (event) => {
					const message: unknown = JSON.parse(String(event.data));
					if (typeof message !== "object" || message === null) {
						return;
					}
					if (isHeapSnapshotChunk(message)) {
						void writer.write(message.params.chunk);
					} else if ("id" in message && message.id === 2) {
						socket.close();
						void Promise.resolve(writer.end()).then(
							() => resume(Effect.void),
							() => fail("Heap snapshot file could not be completed"),
						);
					}
				});
				socket.addEventListener("error", () => fail("Inspector connection failed"));
				return Effect.sync(() => {
					socket.close();
					void writer.end();
				});
			}),
		),
		Effect.timeout("2 minutes"),
	);

export class BenchmarkProfiler extends Context.Service<BenchmarkProfiler>()("BenchmarkProfiler", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const root = Option.getOrUndefined(config.sandbox.benchmarkProfileDir);
		const registry = root === undefined ? undefined : sharedRegistry(root);
		const requireRegistry = () =>
			registry === undefined
				? Effect.fail(
						new SandboxProfilingDisabledError({
							message: "SANDBOX_BENCHMARK_PROFILE_DIR is not configured",
						}),
					)
				: Effect.succeed(registry);
		return {
			root,
			enabled: registry !== undefined,
			disarm: Effect.suspend(() => Effect.map(requireRegistry(), (active) => active.disarm())),
			status: (token: string) => Effect.map(requireRegistry(), (active) => active.status(token)),
			select: (input: { readonly scriptSlug: string; readonly executionKey: string }) =>
				registry?.select(input) ?? null,
			arm: (input: SandboxProfileArm) =>
				Effect.map(requireRegistry(), (active) => {
					active.arm(input);
					return active.status(input.token);
				}),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
