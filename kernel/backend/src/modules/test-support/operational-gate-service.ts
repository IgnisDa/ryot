import type { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	TestSupportBadRequest,
	type TestSupportStartWorkflowLoadGateBody,
} from "@ryot-app/contract/modules/test-support/schemas";
import { AutomationExecutionId, type ImportRunId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { sandboxContextError } from "#lib/infrastructure/sandbox-runtime/limits";
import { getSandboxProcessMetrics } from "#lib/infrastructure/sandbox-runtime/runtime";
import { IngestionExecution } from "#modules/imports/execution-service";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportsService } from "#modules/imports/service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { OperationalGateRepository } from "./operational-gate-repository";

const WORKFLOW_LOAD_GATE_CHUNK_SIZE = 1_000;

type PressureRow = {
	deadlocks: number;
	advisory_locks: number;
	total_connections: number;
	active_connections: number;
	waiting_advisory_locks: number;
	lock_waiting_connections: number;
};

export class OperationalGateService extends Context.Service<OperationalGateService>()(
	"OperationalGateService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const redis = yield* RedisService;
			const imports = yield* ImportsService;
			const repository = yield* ImportsRepository;
			const ingestion = yield* IngestionExecution;
			const gateRepository = yield* OperationalGateRepository;
			const sandbox = yield* SandboxExecutionService;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const receipts = yield* MutationReceipts.make;

			const startWorkflowLoad = Effect.fn("OperationalGateService.startWorkflowLoad")(function* (
				input: TestSupportStartWorkflowLoadGateBody,
			) {
				const accountGeneration = yield* receipts.currentAccount(input.executingUserId);
				const available = yield* pluginRuntime.listPluginsAvailableToUser(input.executingUserId);
				const installation = available.find(({ slug }) => slug === input.pluginSlug);
				if (!installation) {
					return yield* new TestSupportBadRequest({
						reason: {
							code: "invalid-request",
							diagnostic: `Plugin ${input.pluginSlug} is not installed for this user`,
						},
					});
				}
				const run = yield* imports.createManualRun({
					accountGeneration,
					source: input.source,
					userId: input.executingUserId,
					pluginInstallationId: installation.installationId,
					inputSummary: { itemCount: input.itemCount, kind: "workflow-load-operational-gate" },
				});
				const startedAt = yield* DateTime.nowAsDate;
				const occurredAt = IsoUtcString.make(startedAt.toISOString());
				const rootExecutionId = AutomationExecutionId.make(`${run.id}-workflow-load`);
				const scope = { runId: run.id, accountGeneration, userId: input.executingUserId };
				yield* session.transaction(
					Effect.gen(function* () {
						yield* repository.pinIngestion({
							scope,
							plan: { selection: {}, operation: "workflow-load-operational-gate" },
							pins: {
								pluginRevisionId: null,
								executionId: rootExecutionId,
								pluginConfigRevisionId: null,
								scriptId: "workflow-load-operational-gate",
							},
						});
						yield* repository.startIngestion({ scope, startedAt });
					}),
				);

				const items = Array.from({ length: input.itemCount }, (_, index) => ({
					index,
					providerId: input.providerId,
					entitySchemaSlug: input.entitySchemaSlug,
					externalId: `${input.identifierPrefix}-${index}`,
					command: {
						occurredAt,
						accountGeneration,
						itemIdentity: JSON.stringify(["workflow-load", index]),
						causation: {
							depth: 0,
							rootExecutionId,
							source: "import",
							parentRunId: null,
							importRunId: run.id,
							parentTriggerId: null,
							executionId: rootExecutionId,
							initiator: { kind: "user", id: input.executingUserId },
						},
					} satisfies LifecycleCommand,
				}));
				const chunks: Array<typeof items> = [];
				let chunk: typeof items = [];
				for (const item of items) {
					const candidate = [...chunk, item];
					if (
						candidate.length > WORKFLOW_LOAD_GATE_CHUNK_SIZE ||
						sandboxContextError({ items: candidate })
					) {
						if (chunk.length === 0) {
							return yield* new TestSupportBadRequest({
								reason: {
									code: "invalid-request",
									diagnostic: "Workflow load gate item exceeds workflow limits",
								},
							});
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
				yield* session.transaction(
					repository.putActivity(scope, {
						wait: null,
						completed: 0,
						batchId: null,
						parentId: null,
						kind: "writing",
						state: "running",
						id: "workflow-load",
						exactTotal: chunks.length,
						lastAdvancedAt: occurredAt,
						unit: "workflow executions",
					}),
				);

				const executionIds: string[] = [];
				for (const [chunkIndex, packedItems] of chunks.entries()) {
					const executionId = `${run.id}-workflow-load-${chunkIndex}`;
					executionIds.push(executionId);
					yield* sandbox
						.enqueuePluginWorkflow({
							executionId,
							accountGeneration,
							pluginId: installation.id,
							input: { items: packedItems },
							workflowSlug: input.workflowSlug,
							executingUserId: input.executingUserId,
							pluginInstallationId: installation.installationId,
						})
						.pipe(
							Effect.catchTag(
								"SandboxRunError",
								(error) =>
									new TestSupportBadRequest({
										reason: { code: "invalid-request", diagnostic: error.message },
									}),
							),
						);
				}
				return { executionIds, runId: run.id };
			});

			const getWorkflowLoadResult = Effect.fn("OperationalGateService.getWorkflowLoadResult")(
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
					const failures = executions.filter((execution) => execution.status === "failed");
					if (failures.length > 0) {
						yield* Effect.logError("Operational workflow load failed").pipe(
							Effect.annotateLogs({ failures, runId: input.runId }),
						);
					}
					if (executions.every(({ status }) => status === "completed" || status === "failed")) {
						const failed = executions.some(({ status }) => status === "failed");
						const scope = yield* gateRepository.runningScope(input.runId);
						if (scope) {
							const advancedAt = yield* DateTime.nowAsDate;
							yield* session.transaction(
								Effect.gen(function* () {
									yield* repository.putActivity(scope, {
										wait: null,
										batchId: null,
										parentId: null,
										kind: "writing",
										id: "workflow-load",
										unit: "workflow executions",
										completed: executions.length,
										exactTotal: executions.length,
										state: failed ? "failed" : "completed",
										lastAdvancedAt: advancedAt.toISOString(),
									});
									yield* repository.sealCollection(scope);
								}),
							);
							yield* ingestion.settle({
								scope,
								reconcile: () => Effect.succeed([]),
								status: failed ? "failed" : "completed",
								...(failed
									? {
											failureReason: {
												code: "unexpected-failure" as const,
												operation: "workflow-load-operational-gate",
											},
										}
									: {}),
							});
						}
					}
					return { executions, runId: input.runId };
				},
			);

			const samplePressure = Effect.fn("OperationalGateService.samplePressure")(function* (
				executionIds: ReadonlyArray<string>,
			) {
				const [pressure] = yield* session.run((database) =>
					database.execute<PressureRow>(
						sql`
						SELECT
							(SELECT deadlocks::int FROM pg_stat_database WHERE datname = current_database()) AS deadlocks,
							(SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory') AS advisory_locks,
							(SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS total_connections,
							(SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active_connections,
							(SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) AS waiting_advisory_locks,
							(SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock') AS lock_waiting_connections
					`,
						"objects",
					),
				);
				if (!pressure) {
					return yield* Effect.die(new Error("Operational pressure query returned no row"));
				}

				let projectionCount = 0;
				let projectionErrors = 0;
				let maxJournalEntries = 0;
				for (const executionId of executionIds) {
					const fields = yield* Effect.tryPromise(() =>
						redis.client.hgetall(redisKeys.sandboxWorkflowJournal(executionId)),
					).pipe(Effect.orDie);
					if (Object.keys(fields).length === 0) {
						continue;
					}
					projectionCount += 1;
					let entries = 0;
					while (fields[String(entries)] !== undefined) {
						entries += 1;
					}
					if (entries !== Object.keys(fields).length) {
						projectionErrors += 1;
					} else {
						maxJournalEntries = Math.max(maxJournalEntries, entries);
					}
				}

				return {
					sandbox: getSandboxProcessMetrics(),
					redis: { projectionCount, projectionErrors, maxJournalEntries },
					locks: {
						advisoryLocks: pressure.advisory_locks,
						waitingAdvisoryLocks: pressure.waiting_advisory_locks,
					},
					database: {
						deadlocks: pressure.deadlocks,
						totalConnections: pressure.total_connections,
						activeConnections: pressure.active_connections,
						lockWaitingConnections: pressure.lock_waiting_connections,
					},
				};
			});
			return { samplePressure, startWorkflowLoad, getWorkflowLoadResult };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
