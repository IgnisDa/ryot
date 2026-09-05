/**
 * Focused memory-attribution probe. It reuses the benchmark workload plugin and the public provider
 * import API, and records one JSON line per checkpoint so memory states can be compared across
 * variants without a full scenario campaign.
 *
 * Commands:
 *   setup                                  create the benchmark user and workload plugin
 *   checkpoint <label> [gc]                sample runtime + backend heap, optionally after a GC
 *   imports <label> <count> <waves>        submit waves of standard imports, draining each wave
 *   heap-snapshot <label>                  write a heap snapshot inside the container profile dir
 *
 * Environment: E2E_API_URL, E2E_FRONTEND_URL, E2E_ADMIN_ACCESS_TOKEN, PROBE_STATE, PROBE_OUTPUT.
 */
import { appendFile, readFile, writeFile } from "node:fs/promises";

import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect, Schema } from "effect";

import { adminHeaders, createAuthenticatedClient, getApiClient } from "~/fixtures/kernel";

import { resilientSession } from "./scenario-runner";
import { STANDARD_IMPORT_WORKLOAD } from "./scenarios";
import { encodeBenchmarkExternalId } from "./workload-sources";

const ProbeState = Schema.Struct({
	email: Schema.String,
	password: Schema.String,
	bookProviderId: SandboxProviderId,
});
type ProbeState = typeof ProbeState.Type;

const TOKEN = "memory-probe";
const statePath = process.env["PROBE_STATE"] ?? "probe-state.json";
const outputPath = process.env["PROBE_OUTPUT"] ?? "probe.jsonl";

const readState = Effect.promise(() => readFile(statePath, "utf8")).pipe(
	Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ProbeState))),
);

const record = (line: Record<string, unknown>) =>
	Effect.promise(() => appendFile(outputPath, `${JSON.stringify(line)}\n`));

const profile = (label: string, action: "checkpoint" | "gc" | "heap-snapshot") =>
	getApiClient().call(
		(client) =>
			client.testSupport.captureBackendProfile({ payload: { label, action, token: TOKEN } }),
		adminHeaders(),
	);

const runtime = getApiClient().call(
	(client) => client.testSupport.sampleSandboxRuntime({ query: { includeSmaps: "true" } }),
	adminHeaders(),
);

const checkpoint = (label: string, gc: boolean) =>
	Effect.gen(function* () {
		const heap = yield* profile(label, gc ? "gc" : "checkpoint");
		const sample = yield* runtime;
		yield* record({
			gc,
			label,
			jscHeap: heap.jscHeap,
			cgroup: sample.cgroup,
			timestampMs: heap.timestampMs,
			smapsRollup: heap.smapsRollup,
			processMemory: heap.processMemory,
			totalSpawned: sample.totalSpawned,
			activeWorkflows: heap.activeWorkflows,
			workerRssBytes: sample.workerRssBytes,
			totalCompleted: sample.totalCompleted,
			activeProcessCount: sample.activeProcessCount,
			cgroupMemoryCurrentBytes: heap.cgroupMemoryCurrentBytes,
		});
		return heap;
	});

const importWave = (state: ProbeState, label: string, wave: number, count: number) =>
	Effect.gen(function* () {
		const session = yield* resilientSession(state.email, state.password);
		const startedAtMs = yield* Clock.currentTimeMillis;
		const outcomes = yield* Effect.forEach(
			Array.from({ length: count }, (_, index) => index),
			(index) =>
				Effect.gen(function* () {
					const { jobId } = yield* session.call((client) =>
						client.providerEntities.import({
							payload: {
								providerId: state.bookProviderId,
								externalId: encodeBenchmarkExternalId({
									...STANDARD_IMPORT_WORKLOAD,
									nonce: `${label}-${wave}-${index}-${startedAtMs}`,
								}),
							},
						}),
					);
					for (;;) {
						const result = yield* session.call((client) =>
							client.providerEntities.getImportResult({ params: { jobId } }),
						);
						if (result.status !== "queued" && result.status !== "running") {
							return result.status;
						}
						yield* Effect.sleep("1 second");
					}
				}),
			{ concurrency: "unbounded" },
		);
		const terminalAtMs = yield* Clock.currentTimeMillis;
		yield* record({
			count,
			kind: "wave",
			label: `${label}-wave-${wave}`,
			durationMs: terminalAtMs - startedAtMs,
			failed: outcomes.filter((status) => status !== "completed").length,
			completed: outcomes.filter((status) => status === "completed").length,
		});
	});

const [command, ...args] = process.argv.slice(2);

const program = Effect.gen(function* () {
	if (command === "setup") {
		const { email, client, password } = yield* createAuthenticatedClient();
		const { installBenchmarkWorkloadPlugin } = yield* Effect.promise(
			() => import("./workload-plugin"),
		);
		const runId = `probe-${yield* Clock.currentTimeMillis}`;
		const plugin = yield* installBenchmarkWorkloadPlugin({ runId, client });
		const state: ProbeState = { email, password, bookProviderId: plugin.bookProviderId };
		yield* Effect.promise(() => writeFile(statePath, JSON.stringify(state), { mode: 0o600 }));
		return;
	}
	if (command === "checkpoint") {
		yield* checkpoint(args[0] ?? "checkpoint", args[1] === "gc");
		return;
	}
	if (command === "heap-snapshot") {
		yield* profile(args[0] ?? "snapshot", "heap-snapshot");
		return;
	}
	if (command === "imports") {
		const state = yield* readState;
		const label = args[0] ?? "imports";
		const count = Number(args[1] ?? 20);
		const waves = Number(args[2] ?? 1);
		for (let wave = 1; wave <= waves; wave += 1) {
			yield* importWave(state, label, wave, count);
			yield* checkpoint(`${label}-wave-${wave}-drained`, false);
		}
		return;
	}
	throw new Error(`unknown command ${command}`);
});

await Effect.runPromise(program);
