/**
 * Local execution-amplification probe. Starts disposable PostgreSQL/Redis/object storage and one
 * backend, installs the hermetic benchmark workload plugin, then runs direct scripts with
 * 0/1/5/10 loop iterations (two durable host calls each) and standard hermetic imports. For every
 * logical operation it records sandbox counter deltas, process-tree CPU, and a per-workflow and
 * per-script breakdown read from the cluster message table.
 *
 * Prerequisite: the same builds `e2e/global-setup.ts` runs (plugins, client, server assembly).
 * Usage: bun run src/scripts/sandbox-amplification/local-probe.ts <output.json>
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SQL } from "bun";
import { Clock, Effect } from "effect";
import getPort from "get-port";

import { createAuthenticatedClient, sampleSandboxRuntime } from "~/fixtures/kernel";
import { pollSandboxJobResult } from "~/support/benchmark-workload";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

import { enqueueSandboxScript } from "../../fixtures/kernel/sandbox";
import { STANDARD_IMPORT_WORKLOAD } from "../sandbox-resource-baseline/scenarios";
import { installBenchmarkWorkloadPlugin } from "../sandbox-resource-baseline/workload-plugin";
import {
	type BenchmarkWorkloadContext,
	encodeBenchmarkExternalId,
} from "../sandbox-resource-baseline/workload-sources";

const outputPath = process.argv[2];
if (!outputPath) {
	throw new Error("usage: local-probe.ts <output.json>");
}
const repetitions = Number(process.env.PROBE_REPETITIONS ?? 3);
const importRepetitions = Number(process.env.PROBE_IMPORT_REPETITIONS ?? 2);
const batchSize = Number(process.env.PROBE_BATCH_SIZE ?? 5);
const serverCwd = fileURLToPath(new URL("../../../../apps/server", import.meta.url));

const directWorkload = (iterations: number, seed: number): BenchmarkWorkloadContext => ({
	seed,
	perCallDelayMs: 0,
	payloadBytes: 1024,
	suggestionCount: 0,
	relatedEntityCount: 0,
	terminalOutcome: "success",
	durableHostCalls: iterations,
});

/** macOS `ps -S` folds reaped children (Deno workers) into the parent's CPU time. */
const processTreeCpuSeconds = (pid: number) => {
	const result = spawnSync("ps", ["-S", "-o", "time=", "-p", String(pid)], { encoding: "utf8" });
	const [minutes, seconds] = result.stdout.trim().split(":");
	return Number(minutes) * 60 + Number(seconds);
};

const main = async () => {
	const [apiPort, infrastructure] = await Promise.all([
		getPort(),
		startCoreTestInfrastructure({ bucketName: "ryot-probe" }),
	]);
	const frontendUrl = `http://127.0.0.1:${apiPort}`;
	const env = buildApiEnv({
		frontendUrl,
		port: apiPort,
		label: "probe",
		s3BucketName: "ryot-probe",
		dbUrl: infrastructure.dbUrl,
		redisUrl: infrastructure.redisUrl,
		s3Endpoint: infrastructure.s3Endpoint,
		extraEnv: {
			SERVER_LOG_LEVEL: "info",
			SANDBOX_WORKER_CONCURRENCY: "2",
			SCHEDULER_DISABLE_DISPATCHERS: "true",
		},
	});
	const apiProcess = spawnApiProcess(env, serverCwd);
	const sql = new SQL(infrastructure.dbUrl);
	try {
		await waitForHealthCheck(`${frontendUrl}/api/system/health`, "probe", 120);
		process.env.E2E_FRONTEND_URL = frontendUrl;
		process.env.E2E_API_URL = `${frontendUrl}/api`;
		process.env.E2E_ADMIN_ACCESS_TOKEN = String(env.SERVER_ADMIN_ACCESS_TOKEN);
		const pid = apiProcess.pid ?? 0;

		const watermark = async () => {
			const [row] =
				await sql`select coalesce(max(rowid), 0)::bigint as rowid from cluster_messages`;
			const [stats] =
				await sql`select xact_commit::bigint as commits, tup_inserted::bigint as inserted, tup_updated::bigint as updated from pg_stat_database where datname = current_database()`;
			return {
				rowid: BigInt(row.rowid),
				commits: Number(stats.commits),
				updated: Number(stats.updated),
				inserted: Number(stats.inserted),
			};
		};

		const breakdown = async (after: bigint) => {
			const workflows = await sql`
				select entity_type, tag, count(*)::int as count
				from cluster_messages where rowid > ${after.toString()}::bigint
				group by entity_type, tag order by entity_type, tag`;
			const scripts = await sql`
				select coalesce(s.slug, m.payload::jsonb ->> 'scriptId') as script, count(*)::int as runs
				from cluster_messages m
				left join sandbox_script s on s.id = m.payload::jsonb ->> 'scriptId'
				where m.rowid > ${after.toString()}::bigint
					and m.entity_type = 'Workflow/SandboxScriptWorkflow' and m.tag = 'run'
				group by 1 order by 2 desc`;
			// One `observe-sandbox-workflow-replay-N` activity is recorded per Deno replay; the other
			// activity names identify how each durable request was dispatched.
			const steps = await sql`
				with runs as (
					select entity_id, payload::jsonb ->> 'scriptId' as script_id
					from cluster_messages
					where rowid > ${after.toString()}::bigint
						and entity_type = 'Workflow/SandboxScriptWorkflow' and tag = 'run'
				), activities as (
					select entity_id, regexp_replace(
						regexp_replace(payload::jsonb ->> 'name', '-[0-9]+(-|$)', '\\1', 'g'),
						'^sandbox-host-', 'host:') as step
					from cluster_messages
					where rowid > ${after.toString()}::bigint
						and entity_type = 'Workflow/SandboxScriptWorkflow' and tag = 'activity'
				)
				select coalesce(s.slug, r.script_id) as script, a.step, count(*)::int as count
				from runs r
				join activities a using (entity_id)
				left join sandbox_script s on s.id = r.script_id
				group by 1, 2 order by 1, 3 desc`;
			return {
				workflows: workflows.map((row: Record<string, unknown>) => structuredClone(row)),
				sandboxScriptSteps: steps.map((row: Record<string, unknown>) => structuredClone(row)),
				sandboxScriptWorkflowRuns: scripts.map((row: Record<string, unknown>) =>
					structuredClone(row),
				),
			};
		};

		const measure = <A>(label: string, run: Effect.Effect<A, unknown>) =>
			Effect.gen(function* () {
				yield* waitForIdle;
				const beforeDb = yield* Effect.promise(watermark);
				const before = yield* sampleSandboxRuntime;
				const cpuBefore = processTreeCpuSeconds(pid);
				const startedAt = yield* Clock.currentTimeMillis;
				const value = yield* run;
				const latencyMs = (yield* Clock.currentTimeMillis) - startedAt;
				yield* waitForIdle;
				const after = yield* sampleSandboxRuntime;
				const cpuAfter = processTreeCpuSeconds(pid);
				const afterDb = yield* Effect.promise(watermark);
				const detail = yield* Effect.promise(() => breakdown(beforeDb.rowid));
				const record = {
					label,
					latencyMs,
					bunRssBytes: after.backendRssBytes,
					processesSpawned: after.totalSpawned - before.totalSpawned,
					processTreeCpuSeconds: Number((cpuAfter - cpuBefore).toFixed(2)),
					sandboxExecutions: after.executions.total - before.executions.total,
					replaysStarted: after.replays.totalStarted - before.replays.totalStarted,
					replaysCompleted: after.replays.totalCompleted - before.replays.totalCompleted,
					observedJournalBytes: after.replays.totalJournalBytes - before.replays.totalJournalBytes,
					durableRequests: after.replays.totalDurableRequests - before.replays.totalDurableRequests,
					postgres: {
						commits: afterDb.commits - beforeDb.commits,
						updated: afterDb.updated - beforeDb.updated,
						inserted: afterDb.inserted - beforeDb.inserted,
						clusterMessages: Number(afterDb.rowid - beforeDb.rowid),
					},
					...detail,
					value,
				};
				yield* Effect.log(JSON.stringify({ ...record, value: undefined, workflows: undefined }));
				return record;
			});

		const waitForIdle = Effect.gen(function* () {
			for (let attempt = 0; attempt < 600; attempt += 1) {
				const sample = yield* sampleSandboxRuntime;
				if (
					sample.activeProcessCount === 0 &&
					sample.executions.active === 0 &&
					sample.providerImports.executingBodies === 0
				) {
					return;
				}
				yield* Effect.sleep("100 millis");
			}
		});

		const program = Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const plugin = yield* installBenchmarkWorkloadPlugin({ client, runId: `probe-${apiPort}` });

			const direct = (context: BenchmarkWorkloadContext) =>
				Effect.gen(function* () {
					const { jobId } = yield* enqueueSandboxScript(userId, {
						context,
						scriptId: plugin.scriptId,
					});
					const result = yield* pollSandboxJobResult(userId, jobId, 200);
					return result.status;
				});

			const importOnce = (nonce: string) =>
				Effect.gen(function* () {
					const externalId = encodeBenchmarkExternalId({ ...STANDARD_IMPORT_WORKLOAD, nonce });
					const { jobId } = yield* client.call((api) =>
						api.providerEntities.import({
							payload: { externalId, providerId: plugin.bookProviderId },
						}),
					);
					for (;;) {
						const result = yield* client.call((api) =>
							api.providerEntities.getImportResult({ params: { jobId } }),
						);
						if (result.status !== "queued" && result.status !== "running") {
							return result.status;
						}
						yield* Effect.sleep("200 millis");
					}
				});

			const records = [];
			yield* measure("warm-up-direct", direct(directWorkload(0, 1)));
			for (const iterations of [0, 1, 5, 10]) {
				for (let repetition = 0; repetition < repetitions; repetition += 1) {
					records.push(
						yield* measure(
							`direct-${iterations}x2`,
							direct(directWorkload(iterations, 100 + iterations * 10 + repetition)),
						),
					);
				}
			}
			yield* measure("warm-up-import", importOnce(`warm${apiPort}`));
			for (let repetition = 0; repetition < importRepetitions; repetition += 1) {
				records.push(yield* measure("import-standard", importOnce(`r${repetition}p${apiPort}`)));
			}
			records.push(
				yield* measure(
					`import-batch-${batchSize}`,
					Effect.forEach(
						Array.from({ length: batchSize }, (_, index) => index),
						(index) => importOnce(`b${index}p${apiPort}`),
						{ concurrency: "unbounded" },
					),
				),
			);
			return records;
		});

		const records = await Effect.runPromise(program);
		writeFileSync(outputPath, `${JSON.stringify(records, null, "\t")}\n`);
	} finally {
		await sql.close();
		await stopApiProcess(apiProcess);
		await stopCoreTestInfrastructure(infrastructure);
	}
};

await main();
