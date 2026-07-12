import { badRequest } from "@ryot/contract/errors";
import type { TestSupportStartMediaPopulationGateBody } from "@ryot/contract/modules/test-support/schemas";
import type { ImportRunId } from "@ryot/contract/schema/brands";
import { DateTime, Effect } from "effect";

import { DbService, dbEffect } from "#lib/infrastructure/db/service";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { sandboxContextError } from "#lib/infrastructure/sandbox-runtime/limits";
import { getSandboxProcessMetrics } from "#lib/infrastructure/sandbox-runtime/runtime";
import { ImportsService } from "#modules/imports/service";
import { SandboxExecutionService } from "#modules/sandbox/service";

const MEDIA_POPULATION_GATE_CHUNK_SIZE = 1_000;

type PressureRow = {
	deadlocks: number;
	advisory_locks: number;
	total_connections: number;
	active_connections: number;
	waiting_advisory_locks: number;
	lock_waiting_connections: number;
};

export class OperationalGateService extends Effect.Service<OperationalGateService>()(
	"OperationalGateService",
	{
		effect: Effect.gen(function* () {
			const db = yield* DbService;
			const redis = yield* RedisService;
			const imports = yield* ImportsService;
			const sandbox = yield* SandboxExecutionService;

			const startMediaPopulation = Effect.fn("OperationalGateService.startMediaPopulation")(
				function* (input: TestSupportStartMediaPopulationGateBody) {
					const run = yield* imports.create({
						source: "netflix",
						userId: input.executingUserId,
						inputSummary: {
							itemCount: input.itemCount,
							kind: "phase-3-media-population-operational-gate",
						},
					});
					const startedAt = yield* DateTime.nowAsDate;
					yield* imports.update({
						startedAt,
						status: "running",
						runId: run.id,
						totalItems: input.itemCount,
					});

					const items = Array.from({ length: input.itemCount }, (_, index) => ({
						index,
						providerId: input.providerId,
						entitySchemaSlug: input.entitySchemaSlug,
						externalId: `${input.identifierPrefix}-${index}`,
						origin: { kind: "import" as const, importRunId: run.id },
					}));
					const chunks: Array<typeof items> = [];
					let chunk: typeof items = [];
					for (const item of items) {
						const candidate = [...chunk, item];
						if (
							candidate.length > MEDIA_POPULATION_GATE_CHUNK_SIZE ||
							sandboxContextError({ items: candidate }, { kind: "workflow" })
						) {
							if (chunk.length === 0) {
								return yield* badRequest("Media population gate item exceeds workflow limits");
							}
							chunks.push(chunk);
							chunk = [item];
						} else {
							chunk = candidate;
						}
					}
					if (chunk.length > 0) {
						chunks.push(chunk);
					}

					const executionIds: string[] = [];
					for (const [chunkIndex, packedItems] of chunks.entries()) {
						const executionId = `${run.id}-phase-3-population-${chunkIndex}`;
						executionIds.push(executionId);
						yield* sandbox
							.enqueuePluginWorkflow({
								executionId,
								pluginSlug: "media",
								workflowSlug: "media-import-population",
								executingUserId: input.executingUserId,
								input: { items: packedItems },
							})
							.pipe(Effect.catchTag("SandboxRunError", (error) => badRequest(error.message)));
					}
					return { executionIds, runId: run.id };
				},
			);

			const getMediaPopulationResult = Effect.fn("OperationalGateService.getMediaPopulationResult")(
				function* (input: {
					itemCount: number;
					runId: ImportRunId;
					executionIds: ReadonlyArray<string>;
				}) {
					const executions = yield* Effect.forEach(input.executionIds, (executionId) =>
						sandbox
							.getPluginWorkflowResult(executionId)
							.pipe(Effect.map((result) => ({ executionId, ...result }))),
					);
					if (executions.every(({ status }) => status === "completed" || status === "failed")) {
						const failed = executions.some(({ status }) => status === "failed");
						const finishedAt = yield* DateTime.nowAsDate;
						yield* imports.update({
							finishedAt,
							runId: input.runId,
							progress: 100,
							processedItems: input.itemCount,
							importedItems: failed ? 0 : input.itemCount,
							failedItems: failed ? input.itemCount : 0,
							status: failed ? "failed" : "completed",
						});
					}
					return { executions, runId: input.runId };
				},
			);

			const samplePressure = Effect.fn("OperationalGateService.samplePressure")(function* (
				executionIds: ReadonlyArray<string>,
			) {
				const pressure = yield* dbEffect(() =>
					db.pool.query<PressureRow>(`
						SELECT
							(SELECT deadlocks::int FROM pg_stat_database WHERE datname = current_database()) AS deadlocks,
							(SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory') AS advisory_locks,
							(SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS total_connections,
							(SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active_connections,
							(SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) AS waiting_advisory_locks,
							(SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock') AS lock_waiting_connections
					`),
				).pipe(Effect.map((result) => result.rows[0]));
				if (!pressure) {
					return yield* Effect.dieMessage("Operational pressure query returned no row");
				}

				let projectionCount = 0;
				let projectionErrors = 0;
				let maxHighWater = 0;
				for (const executionId of executionIds) {
					let cursor = "0";
					do {
						const [nextCursor, keys] = yield* Effect.tryPromise(() =>
							redis.client.scan(
								cursor,
								"MATCH",
								`${redisKeys.sandboxWorkflowJournal(executionId)}*`,
								"COUNT",
								100,
							),
						).pipe(Effect.orDie);
						cursor = nextCursor;
						for (const key of keys) {
							projectionCount += 1;
							const fields = yield* Effect.tryPromise(() => redis.client.hgetall(key)).pipe(
								Effect.orDie,
							);
							const highWater = Number(fields["high-water"]);
							if (
								!Number.isSafeInteger(highWater) ||
								highWater < 0 ||
								Array.from({ length: highWater }, (_, index) => fields[index]).some(
									(value) => value === undefined,
								)
							) {
								projectionErrors += 1;
							} else {
								maxHighWater = Math.max(maxHighWater, highWater);
							}
						}
					} while (cursor !== "0");
				}

				return {
					locks: {
						advisoryLocks: pressure.advisory_locks,
						waitingAdvisoryLocks: pressure.waiting_advisory_locks,
					},
					redis: { projectionCount, projectionErrors, maxHighWater },
					sandbox: getSandboxProcessMetrics(),
					database: {
						deadlocks: pressure.deadlocks,
						activeConnections: pressure.active_connections,
						totalConnections: pressure.total_connections,
						lockWaitingConnections: pressure.lock_waiting_connections,
						appPoolIdleConnections: db.pool.idleCount,
						appPoolTotalConnections: db.pool.totalCount,
						appPoolWaitingRequests: db.pool.waitingCount,
					},
				};
			});

			return { samplePressure, startMediaPopulation, getMediaPopulationResult };
		}),
	},
) {}
