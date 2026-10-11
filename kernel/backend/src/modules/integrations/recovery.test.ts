import { assert, expect, layer } from "@effect/vitest";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { eq, sql } from "drizzle-orm";
import { DateTime, Effect, Layer } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { IngestionCaptures } from "#modules/imports/capture-service";
import { IngestionExecution } from "#modules/imports/execution-service";
import { ImportsRepository } from "#modules/imports/repository";
import type { IngestionRecoveryCursor } from "#modules/imports/runtime/recovery-cursor";
import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { ImportWorkflowPinning } from "#modules/imports/workflow-pinning";
import { IngestionReadinessService } from "#modules/plugins/ingestion-readiness-service";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { SandboxPluginScriptResolver } from "#modules/sandbox/plugin-script-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { IntegrationIngestion } from "./ingestion";
import { makeIntegration } from "./test-support";

layer(
	IntegrationIngestion.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				Layer.mock(IngestionCaptures)({}),
				Layer.mock(IngestionExecution)({}),
				Layer.mock(ImportSourceStateStore)({}),
				Layer.mock(ImportWorkflowPinning)({}),
				Layer.mock(IngestionReadinessService)({}),
				Layer.mock(PluginInstallationRepository)({}),
				Layer.mock(SandboxPluginScriptResolver)({}),
				Layer.mock(SandboxExecutionService)({}),
				ImportsRepository.layer,
			),
		),
		Layer.provideMerge(isolatedDatabaseLayer("integration_recovery")),
	),
)((test) => {
	test.effect(
		"commits rejected deliveries as terminal before shared workers can recover them",
		() =>
			Effect.gen(function* () {
				const database = yield* DatabaseSession;
				const repository = yield* ImportsRepository;
				const ingestion = yield* IntegrationIngestion;
				const integration = makeIntegration({
					provider: "data-json",
					pluginInstallationId: null,
					userId: UserId.make("rejected-user"),
					id: IntegrationId.make("rejected-integration"),
				});
				yield* database.run((db) =>
					db
						.insert(tables.user)
						.values({
							name: "Rejected",
							id: integration.userId,
							email: "rejected@example.test",
							accountGeneration: "generation",
						}),
				);
				yield* database.run((db) =>
					db
						.insert(tables.integration)
						.values({
							lot: "sink",
							id: integration.id,
							providerSpecifics: {},
							userId: integration.userId,
							clientProviderSpecifics: {},
							webhookToken: "rejected-token",
							provider: integration.provider,
							extraSettings: { disableOnContinuousErrors: false },
						}),
				);
				for (const code of [
					"integration-disabled",
					"integrations-disabled",
					"pro-key-required",
				] as const) {
					const scope = yield* ingestion.admitWebhook(
						integration,
						{ rawBody: "{}", contentType: "application/json" },
						{ code },
					);
					expect(
						yield* repository.getRunById({ runId: scope.runId, userId: scope.userId }),
					).toMatchObject({ startedAt: null, status: "failed", failureReason: { code } });
					expect(yield* ingestion.inputReady(scope)).toBe(false);
					expect(yield* ingestion.release(scope, integration)).toBe(false);
				}
				expect(
					(yield* ingestion.recoverable({ after: null, before: "2030-01-01T00:00:00.000Z" })).runs,
				).toEqual([]);
			}),
	);
	test.effect(
		"keyset recovery crosses an unreleasable first page and excludes owners after the cutoff",
		() =>
			Effect.gen(function* () {
				const database = yield* DatabaseSession;
				const repository = yield* ImportsRepository;
				const ingestion = yield* IntegrationIngestion;
				const userId = UserId.make("recovery-user");
				const integrationId = IntegrationId.make("recovery-integration");
				const before = "2026-10-03T12:00:00.000Z";
				const date = DateTime.toDateUtc(DateTime.makeUnsafe(before));
				yield* database.run((db) =>
					db
						.insert(tables.user)
						.values({
							id: userId,
							name: "Recovery",
							email: "recovery@example.test",
							accountGeneration: "generation",
						}),
				);
				yield* database.run((db) =>
					db
						.insert(tables.integration)
						.values({
							userId,
							lot: "sink",
							id: integrationId,
							provider: "data-json",
							providerSpecifics: {},
							clientProviderSpecifics: {},
							webhookToken: "recovery-token",
							extraSettings: { disableOnContinuousErrors: false },
						}),
				);
				const owners = [];
				for (let index = 0; index < 108; index++) {
					const id = yield* database.transaction(
						repository.createBlockedRun({
							userId,
							integrationId,
							acceptedAt: date,
							inputSummary: {},
							source: "data-json",
							pluginInstallationId: null,
							accountGeneration: { userId, token: "generation" },
							blockReasons: [{ key: "endpoint", code: "configuration-required" }],
						}),
					);
					owners.push(id);
					yield* database.run((db) =>
						db
							.update(tables.importRun)
							.set({
								createdAt:
									index === 107
										? DateTime.toDateUtc(DateTime.add(DateTime.makeUnsafe(before), { seconds: 1 }))
										: date,
								blockDeadline: DateTime.toDateUtc(
									DateTime.add(DateTime.makeUnsafe(before), {
										days: 7,
										seconds: index === 107 ? 1 : 0,
									}),
								),
							})
							.where(eq(tables.importRun.id, id)),
					);
				}
				const sorted = owners.slice(0, 107).sort();
				for (const [index, status] of [
					[105, "pending"],
					[106, "cancelling"],
				] as const) {
					const runId = sorted[index];
					assert(runId);
					const scope = { runId, userId, accountGeneration: { userId, token: "generation" } };
					yield* repository.releaseBlocked({
						scope,
						now: date,
						plan: { selection: {}, operation: "collect" },
						pins: {
							scriptId: "script",
							pluginRevisionId: null,
							executionId: "source-owner",
							pluginConfigRevisionId: null,
						},
					});
					if (status === "cancelling") {
						yield* repository.cancelIngestion(scope);
						const activity = {
							wait: null,
							completed: 0,
							batchId: null,
							parentId: null,
							exactTotal: null,
							lastAdvancedAt: before,
							id: "source-confirmation",
							state: "running" as const,
							kind: "finishing" as const,
							unit: "confirmation-attempts",
						};
						const denied = yield* Effect.exit(
							database.transaction(repository.putActivity(scope, activity)),
						);
						expect(denied._tag).toBe("Failure");
						yield* database.transaction(repository.putSettlementActivity(scope, activity));
						expect((yield* repository.getIngestionRun(scope))?.activities).toEqual([activity]);
					}
				}
				const first = yield* ingestion.recoverable({ before, after: null });
				expect(first.runs.map((owner) => owner.runId)).toEqual(sorted.slice(0, 100));
				expect(first.next).toEqual({ id: sorted[99], createdAt: before });
				const second = yield* ingestion.recoverable({ before, after: first.next });
				expect(second.runs.map((owner) => owner.runId)).toEqual(sorted.slice(100));
				expect(second.next).toBeNull();
				expect(second.runs.map((owner) => owner.runId)).not.toContain(owners[107]);
			}),
	);
	test.effect("keyset recovery pages runs whose creation times were written by the database", () =>
		Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const repository = yield* ImportsRepository;
			const userId = UserId.make("database-time-user");
			const integrationId = IntegrationId.make("database-time-integration");
			const before = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-03T11:30:00.000Z"));
			yield* database.run((db) =>
				db
					.insert(tables.user)
					.values({
						id: userId,
						name: "Database time",
						accountGeneration: "generation",
						email: "database-time@example.test",
					}),
			);
			yield* database.run((db) =>
				db
					.insert(tables.integration)
					.values({
						userId,
						lot: "sink",
						id: integrationId,
						provider: "data-json",
						providerSpecifics: {},
						clientProviderSpecifics: {},
						webhookToken: "database-time-token",
						extraSettings: { disableOnContinuousErrors: false },
					}),
			);
			const runIds = [];
			for (const microseconds of ["100", "200", "300"]) {
				const id = yield* database.transaction(
					repository.createBlockedRun({
						userId,
						integrationId,
						inputSummary: {},
						acceptedAt: before,
						source: "data-json",
						pluginInstallationId: null,
						accountGeneration: { userId, token: "generation" },
						blockReasons: [{ key: "endpoint", code: "configuration-required" }],
					}),
				);
				yield* database.run((db) =>
					db.execute(
						sql`update import_run set created_at = ${`2026-10-03T11:00:00.000${microseconds}Z`}::timestamptz, block_deadline = ${`2026-10-03T11:00:00.000${microseconds}Z`}::timestamptz + interval '7 days' where id = ${id}`,
					),
				);
				runIds.push(id);
			}
			const page = (after: IngestionRecoveryCursor | null) =>
				repository.listIntegrationRecoveryRuns({ after, before, limit: 1 });
			const paged = [];
			let after: IngestionRecoveryCursor | null = null;
			for (let attempt = 0; attempt < 5; attempt++) {
				const rows: ReadonlyArray<{ run: typeof tables.importRun.$inferSelect }> =
					yield* page(after);
				const last = rows.at(-1)?.run;
				if (!last) {
					break;
				}
				paged.push(last.id);
				after = {
					id: ImportRunId.make(last.id),
					createdAt: IsoUtcString.make(last.createdAt.toISOString()),
				};
			}
			expect([...paged].sort()).toEqual([...runIds].sort());
		}),
	);
});
