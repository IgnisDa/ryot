import { unknownToMessage } from "@ryot-app/contract/errors";
import { Clock, Console, Effect, Schema } from "effect";
import getPort from "get-port";

import { createAuthenticatedClient, getImportRun, uploadImportFile } from "~/fixtures/kernel";
import {
	findFitnessEntitySchema,
	readMeasurementLogReadings,
	startOpenScaleImport,
} from "~/fixtures/plugins/fitness";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import {
	buildApiEnv,
	harnessApiEnv,
	startApiProcess,
	startCoreTestInfrastructure,
} from "~/support/provisioning";

const ROW_COUNT = 3_201;
const BUDGET_MS = 900_000;
const RUN_OPERATIONAL_GATES = process.env.RUN_OPERATIONAL_GATES === "1";
const Sample = Schema.Struct({
	steps: Schema.Int,
	journalRows: Schema.Int,
	obsoleteSteps: Schema.Int,
	checkpointBytes: Schema.Int,
	applicationRevision: Schema.Int,
	applicationCompleted: Schema.Int,
});

describe.skipIf(!RUN_OPERATIONAL_GATES)("Fitness import checkpoint recovery at scale", () => {
	it.live(
		"resumes after a process kill without repeating committed measurements",
		() =>
			Effect.gen(function* () {
				const bucketName = "ryot-fitness-checkpoint-scale";
				const infrastructure = yield* startCoreTestInfrastructure({ bucketName });
				const port = yield* Effect.promise(() => getPort());
				const env = buildApiEnv({
					port,
					extraEnv: harnessApiEnv,
					s3BucketName: bucketName,
					dbUrl: infrastructure.dbUrl,
					label: "Fitness checkpoint scale",
					s3Endpoint: infrastructure.s3Endpoint,
					frontendUrl: `http://127.0.0.1:${port}`,
				});
				const api = yield* startApiProcess(env, "Fitness checkpoint scale");
				const { client, userId } = yield* createAuthenticatedClient(api.target);
				const { pluginId } = yield* findFitnessEntitySchema(client, "measurement-metric");
				const connection = yield* Effect.acquireRelease(
					Effect.sync(() => new Bun.SQL(infrastructure.dbUrl, { max: 1 })),
					(sql) => Effect.promise(() => sql.close()),
				);
				const sample = Effect.fn("sampleCheckpointImport")(function* () {
					const rows: unknown = yield* Effect.tryPromise({
						catch: unknownToMessage,
						try: () => connection`
							WITH executions AS (
								SELECT * FROM workflow_execution WHERE account_user_id = ${userId}
							), application AS (
								SELECT * FROM executions WHERE checkpoint ->> 'state' = 'active'
								AND checkpoint #>> '{checkpoint,completed}' IS NOT NULL
							)
							SELECT
								(SELECT count(*)::int FROM workflow_step s JOIN executions e USING (workflow_name, execution_id)) AS steps,
								(SELECT count(*)::int FROM sandbox_journal_entry) AS "journalRows",
								(SELECT coalesce(max(octet_length(checkpoint::text)), 0)::int FROM executions) AS "checkpointBytes",
								(SELECT coalesce(max((checkpoint ->> 'revision')::int), 0) FROM application) AS "applicationRevision",
								(SELECT coalesce(max((checkpoint #>> '{checkpoint,completed}')::int), 0) FROM application) AS "applicationCompleted",
								(SELECT count(*)::int FROM workflow_step s JOIN executions e USING (workflow_name, execution_id)
								 WHERE s.name LIKE 'checkpoint-%/%' AND e.checkpoint ->> 'state' = 'active'
								 AND split_part(split_part(s.name, '/', 1), '-', 2)::int < (e.checkpoint ->> 'revision')::int) AS "obsoleteSteps"
						`,
					});
					return requirePresent(
						(yield* Schema.decodeUnknownEffect(Schema.Array(Sample))(rows))[0],
						"Expected checkpoint sample",
					);
				});
				const csv = [
					"dateTime,weight",
					...Array.from(
						{ length: ROW_COUNT },
						(_, index) =>
							`${new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString()},${70 + index / 1000}`,
					),
				].join("\n");
				const uploadToken = yield* uploadImportFile(
					client,
					csv,
					"checkpoint-scale.csv",
					"text/csv",
				);
				const startedAt = yield* Clock.currentTimeMillis;
				const runId = yield* startOpenScaleImport(client, pluginId, {
					uploadToken,
					timezone: "UTC",
				});
				const samples: (typeof Sample.Type & { elapsedMs: number })[] = [];
				let killedAt: number | undefined;
				let healthyAfterKillMs: number | undefined;
				let nextCheckpointAfterKillMs: number | undefined;
				let completedBeforeKill = 0;
				for (;;) {
					const now = yield* Clock.currentTimeMillis;
					expect(now - startedAt).toBeLessThan(BUDGET_MS);
					const measurement = yield* sample();
					samples.push({ ...measurement, elapsedMs: now - startedAt });
					expect(measurement.obsoleteSteps).toBe(0);
					if (killedAt === undefined && measurement.applicationCompleted > 0) {
						completedBeforeKill = measurement.applicationCompleted;
						expect(completedBeforeKill).toBeLessThan(ROW_COUNT);
						killedAt = yield* Clock.currentTimeMillis;
						api.kill("SIGKILL");
						yield* Effect.promise(() => api.exited);
						yield* startApiProcess(env, "Fitness checkpoint scale recovered");
						healthyAfterKillMs = (yield* Clock.currentTimeMillis) - killedAt;
					}
					if (
						killedAt !== undefined &&
						nextCheckpointAfterKillMs === undefined &&
						measurement.applicationCompleted > completedBeforeKill
					) {
						nextCheckpointAfterKillMs = now - killedAt;
					}
					const run = requirePresent(
						(yield* getImportRun(client, runId, undefined, 20)).run,
						"Expected import run",
					);
					if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
						assertCompleted(run, "Checkpoint scale import");
						expect(run.summary).toEqual([
							{
								unit: "measurements",
								recordKind: "measurements",
								counts: {
									updated: 0,
									skipped: 0,
									unchanged: 0,
									unsuccessful: 0,
									created: ROW_COUNT,
								},
							},
						]);
						break;
					}
					yield* Effect.sleep("1 second");
				}
				const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;
				expect(killedAt).toBeDefined();
				const readings = [];
				let after: string | undefined;
				do {
					const page = yield* readMeasurementLogReadings(client, {
						after,
						limit: 100,
						reference: { pluginId, kind: "local" },
					});
					readings.push(...page.items);
					after = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
				} while (after !== undefined);
				expect(readings).toHaveLength(ROW_COUNT);
				expect(new Set(readings.map(({ occurredAt }) => occurredAt)).size).toBe(ROW_COUNT);
				expect(new Set(readings.map(({ id }) => id)).size).toBe(ROW_COUNT);
				yield* Console.log(
					yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
						samples,
						elapsedMs,
						rows: ROW_COUNT,
						healthyAfterKillMs,
						completedBeforeKill,
						nextCheckpointAfterKillMs,
						probe: "fitness-checkpoint-recovery",
					}),
				);
			}),
		BUDGET_MS + 120_000,
	);
});
