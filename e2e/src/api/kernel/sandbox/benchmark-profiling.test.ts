import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	enqueueSandboxScript,
	getApiClient,
	installTestPluginBundle,
	pollSandboxResult,
	requireCompletedSandboxValue,
	sampleSandboxRuntime,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const scriptSource = (slug: string) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  slug: ${JSON.stringify(slug)},
  kind: "script",
  name: "Benchmark profiling",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  capabilities: ["getUserPreferences"],
});

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({ allowNsfw: Schema.Boolean }),
  run: (_input, host) =>
    Effect.map(host.getUserPreferences(), (preferences) => ({ allowNsfw: preferences.allowNsfw })),
});
`;

const benchmarkProfileRoot = () =>
	requirePresent(process.env["E2E_BENCHMARK_PROFILE_DIR"], "E2E_BENCHMARK_PROFILE_DIR is not set");

const fileMode = async (path: string) => {
	const stats = await stat(path);
	return stats.mode & 0o777;
};

describe("Benchmark profiling", () => {
	it.live("profiles every replay attempt of one armed execution into restricted files", () =>
		Effect.gen(function* () {
			const root = benchmarkProfileRoot();
			const { client, userId } = yield* createAuthenticatedClient();
			const pluginSlug = `e2e-benchmark-profiling-${crypto.randomUUID()}`;
			const scriptSlug = `${pluginSlug}.script`;
			const token = `profile-${crypto.randomUUID()}`;
			const installed = yield* installTestPluginBundle({
				client,
				pluginSlug,
				files: { "backend/scripts/profiled.sandbox.ts": scriptSource(scriptSlug) },
				scripts: [
					{
						kind: "script",
						slug: scriptSlug,
						name: "Benchmark profiling",
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
						capabilities: ["getUserPreferences"],
						entry: "backend/scripts/profiled.sandbox.ts",
					},
				],
			});
			yield* getApiClient().call(
				(api) =>
					api.testSupport.armSandboxProfile({
						payload: {
							token,
							scriptSlug,
							executions: 1,
							cpuProfile: true,
							maxAttemptsPerExecution: 4,
							maxHeapSnapshotsPerAttempt: 1,
						},
					}),
				adminHeaders(),
			);
			const before = yield* sampleSandboxRuntime;

			const { jobId } = yield* enqueueSandboxScript(userId, {
				context: {},
				scriptId: requirePresent(installed.scriptIds[scriptSlug], "script was not installed"),
			});
			expect(requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId))).toEqual({
				allowNsfw: false,
			});

			const status = yield* getApiClient().call(
				(api) => api.testSupport.getSandboxProfileStatus({ params: { token } }),
				adminHeaders(),
			);
			expect(status.armed).toBe(false);
			const attempts = requirePresent(status.executions[0], "no profiled execution").attempts;
			expect(
				attempts.map(({ error, attempt, finished }) => ({ error, attempt, finished })),
			).toEqual([
				{ attempt: 1, error: null, finished: true },
				{ attempt: 2, error: null, finished: true },
			]);

			const attemptDirectory = join(root, token, "execution-1", "attempt-2");
			const files = (yield* Effect.promise(() => readdir(attemptDirectory))).sort();
			expect(files).toContain("cpu.cpuprofile");
			expect(files).toContain("checkpoints.jsonl");
			expect(files.filter((name) => name.endsWith(".heapsnapshot"))).toHaveLength(1);
			expect(yield* Effect.promise(() => fileMode(join(root, token)))).toBe(0o700);
			for (const file of files) {
				expect(yield* Effect.promise(() => fileMode(join(attemptDirectory, file)))).toBe(0o600);
			}
			const cpuProfile: unknown = JSON.parse(
				yield* Effect.promise(() => readFile(join(attemptDirectory, "cpu.cpuprofile"), "utf8")),
			);
			expect(cpuProfile).toMatchObject({ nodes: expect.any(Array), samples: expect.any(Array) });
			const checkpoints = (yield* Effect.promise(() =>
				readFile(join(attemptDirectory, "checkpoints.jsonl"), "utf8"),
			))
				.trim()
				.split("\n")
				.map((line): { checkpoint: string; denoMemory: unknown } => JSON.parse(line));
			expect(checkpoints.map(({ checkpoint }) => checkpoint)).toEqual([
				"runner-ready",
				"module-imported",
				"journal-loaded",
				"result-built",
				"response-encoded",
			]);
			expect(checkpoints[0]?.denoMemory).toMatchObject({ rss: expect.any(Number) });

			const after = yield* getApiClient().call(
				(api) =>
					api.testSupport.sampleSandboxRuntime({
						query: { completedAfterSequence: before.completedWorkerSequence },
					}),
				adminHeaders(),
			);
			expect(after.configuration.benchmarkProfilingEnabled).toBe(true);
			expect(after.completedWorkers.length).toBeGreaterThanOrEqual(2);
			expect(
				after.completedWorkers.every(({ sequence }) => sequence > before.completedWorkerSequence),
			).toBe(true);
		}),
	);

	it.live("captures backend checkpoints, CPU and heap profiles under the token directory", () =>
		Effect.gen(function* () {
			const root = benchmarkProfileRoot();
			const token = `backend-${crypto.randomUUID()}`;
			const capture = (action: "checkpoint" | "gc" | "cpu-start" | "cpu-stop" | "heap-snapshot") =>
				getApiClient().call(
					(api) =>
						api.testSupport.captureBackendProfile({ payload: { token, action, label: action } }),
					adminHeaders(),
				);

			const checkpoint = yield* capture("checkpoint");
			expect(checkpoint.file).toBeNull();
			expect(checkpoint.jscHeap.topObjectTypes.length).toBeGreaterThan(0);
			yield* capture("cpu-start");
			yield* sampleSandboxRuntime;
			const cpu = yield* capture("cpu-stop");
			const heap = yield* capture("heap-snapshot");
			yield* capture("gc");

			const files = yield* Effect.promise(() => readdir(join(root, token)));
			expect(files.sort()).toEqual(
				[
					"bun-checkpoints.jsonl",
					requirePresent(cpu.file, "cpu profile file"),
					requirePresent(heap.file, "heap snapshot file"),
				].sort(),
			);
			const stackTraces: unknown = JSON.parse(
				yield* Effect.promise(() => readFile(join(root, token, "bun-cpu-cpu-stop.json"), "utf8")),
			);
			expect(stackTraces).toMatchObject({ traces: expect.any(Array) });
		}),
	);
});
