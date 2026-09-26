import { BunServices } from "@effect/platform-bun";
import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { ImportRunId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { DateTime, Effect, FileSystem, Layer, Option, Redacted, Schema } from "effect";
import { ClusterWorkflowEngine, SingleRunner } from "effect/cluster";
import { Reactivity } from "effect/reactivity";
import { DurableDeferred, Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { HmacSigner } from "#lib/infrastructure/hmac-signer";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { S3Service } from "#lib/infrastructure/s3";
import { SandboxArtifactStaging } from "#lib/infrastructure/sandbox-runtime/artifact-staging";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { IsolatedDatabase, isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { IngestionPayloads } from "#modules/uploads/object-storage/ingestion-payloads";

import { IngestionCaptures } from "./capture-service";
import { IngestionCaptureWorkflowDefinitionsLive } from "./capture-write-workflow";
import { IngestionArtifactStagingProvidedLive } from "./layer";
import { ImportsRepository } from "./repository";
import { ImportRunError } from "./runtime/workflow-errors";

const CollectorCaller = Workflow.make("StagedCollectorCaller", {
	error: ImportRunError,
	success: Schema.String,
	payload: { runId: ImportRunId },
	idempotencyKey: ({ runId }) => runId,
});
const collected = DurableDeferred.make("collector-success", { success: Schema.Void });
const published = DurableDeferred.make("publication-success", { success: Schema.Void });

layer(
	Layer.mergeAll(BunServices.layer, Reactivity.layer, isolatedDatabaseLayer("staged_journal")),
	{ excludeTestServices: true },
)((test) => {
	test.effect(
		"restarts after collector success and publication before caller completion with SQL journals",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const database = yield* DatabaseSession;
				const { url } = yield* IsolatedDatabase;
				const userId = UserId.make("staged-owner");
				const scope = {
					userId,
					runId: ImportRunId.make("staged-run"),
					accountGeneration: { userId, token: "generation" },
				};
				const ownerExecutionId = "pinned-ingestion-owner";
				yield* database.run((db) =>
					db
						.insert(tables.user)
						.values({
							id: userId,
							name: "Owner",
							email: "staged@example.test",
							accountGeneration: "generation",
						}),
				);
				yield* database.run((db) =>
					db
						.insert(tables.importRun)
						.values({
							userId,
							id: scope.runId,
							status: "running",
							source: "data-json",
							accountGeneration: "generation",
							pins: {
								scriptId: "collector",
								pluginRevisionId: null,
								pluginConfigRevisionId: null,
								executionId: ownerExecutionId,
							},
						}),
				);
				const directory = yield* fs.makeTempDirectoryScoped({
					directory: "/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode",
				});
				const temporary = `${directory}/temporary`;
				yield* fs.makeDirectory(temporary);
				const infrastructure = Layer.mergeAll(
					BunServices.layer,
					makeAppConfigLayer({
						database: { url: Redacted.make(url) },
						fileStorage: { localTempDir: temporary, localDir: `${directory}/permanent` },
					}),
					Layer.mock(S3Service)({ isConfigured: false }),
					Layer.mock(HmacSigner)({}),
				);
				const engineLayer = ClusterWorkflowEngine.layer.pipe(
					Layer.provide(
						SingleRunner.layer({
							runnerStorage: "sql",
							shardingConfig: { shardLockDisableAdvisory: true },
						}),
					),
					Layer.provide(PgClient.layer({ url: Redacted.make(url) })),
					Layer.provide(BunServices.layer),
				);
				const repositories = ImportsRepository.layer.pipe(
					Layer.provideMerge(DatabaseSession.layer),
				);
				const services = IngestionCaptures.layer.pipe(
					Layer.provideMerge(repositories),
					Layer.provideMerge(IngestionPayloads.layer),
					Layer.provideMerge(LocalStorageService.layer),
					Layer.provideMerge(engineLayer),
					Layer.provideMerge(infrastructure),
				);
				const staging = IngestionArtifactStagingProvidedLive.pipe(Layer.provideMerge(services));
				let collections = 0;
				let callerCompletions = 0;
				let handle = "";
				const caller = implementWorkflow(CollectorCaller, (_, executionId) =>
					Effect.gen(function* () {
						const captures = yield* IngestionCaptures;
						const staged = yield* makeActivity({
							name: "COLLECTOR",
							error: ImportRunError,
							success: Schema.String,
							execute: Effect.gen(function* () {
								collections += 1;
								const source = `${temporary}/collector-output`;
								yield* fs.writeFile(source, new TextEncoder().encode("collected once"));
								const port = yield* SandboxArtifactStaging;
								const harvest = yield* port.prepare({
									context: {},
									compiledCode: "",
									compiledFormat: 1,
									workflowExecutionId: executionId,
									executionId: `${executionId}-COLLECTOR`,
									startedAt: (yield* DateTime.nowAsDate).toISOString(),
									grants: { artifactOwnerExecutionId: ownerExecutionId },
									principal: {
										providerId: null,
										pluginRevision: null,
										scriptSlug: "collector",
										contentHash: "collector-hash",
										scriptId: SandboxScriptId.make("collector"),
										subject: { userId, type: "user", accountGeneration: scope.accountGeneration },
										metadata: { kind: "operation", runtimeImports: [], capabilities: ["scratch"] },
									},
								});
								if (!harvest) {
									return yield* new ImportRunError({
										message: "Collector staging owner was not found",
									});
								}
								const handles = yield* harvest([source]);
								expect(yield* harvest([source])).toEqual(handles);
								yield* fs.writeFile(source, new TextEncoder().encode("changed collector output"));
								expect((yield* Effect.exit(harvest([source])))._tag).toBe("Failure");
								const result = handles[0];
								if (!result) {
									return yield* new ImportRunError({ message: "Collector output was not staged" });
								}
								handle = result;
								return result;
							}).pipe(Effect.mapError((error) => new ImportRunError({ message: String(error) }))),
						});
						yield* DurableDeferred.await(collected);
						const publication = {
							scope,
							ordinal: 64,
							id: "page-1",
							maxBytes: 1024,
							checkpoint: { page: 1 },
							state: "sealed" as const,
							phase: "collection" as const,
						};
						let capture = yield* captures.resume(publication);
						capture ??= yield* captures.publish({
							...publication,
							bytes: yield* captures.readStaged(scope, ownerExecutionId, staged),
						});
						yield* DurableDeferred.await(published);
						yield* makeActivity({
							success: Schema.Void,
							name: "CALLER-COMPLETE",
							execute: Effect.sync(() => {
								callerCompletions += 1;
							}),
						});
						return capture.id;
					}).pipe(Effect.mapError((error) => new ImportRunError({ message: String(error) }))),
				);
				const workflows = Layer.merge(caller, IngestionCaptureWorkflowDefinitionsLive).pipe(
					Layer.provideMerge(staging),
				);
				const waitSuspended = (captureCount: number) =>
					Effect.gen(function* () {
						const engine = yield* WorkflowEngine;
						for (;;) {
							const result = yield* engine.poll(CollectorCaller, scope.runId);
							const captures = yield* database.run((db) => db.select().from(tables.importCapture));
							if (
								Option.isSome(result) &&
								result.value._tag === "Suspended" &&
								captures.length === captureCount
							) {
								break;
							}
							yield* Effect.sleep("20 millis");
						}
					}).pipe(Effect.timeout("15 seconds"));
				const activation = <E>(body: Effect.Effect<void, E, WorkflowEngine | IngestionCaptures>) =>
					Effect.scoped(
						Layer.build(workflows).pipe(
							Effect.flatMap((context) => body.pipe(Effect.provideContext(context))),
						),
					);
				yield* activation(
					Effect.gen(function* () {
						const engine = yield* WorkflowEngine;
						yield* engine.execute(CollectorCaller, {
							discard: true,
							executionId: scope.runId,
							payload: { runId: scope.runId },
						});
						yield* waitSuspended(0);
					}),
				);
				expect(collections).toBe(1);
				expect(handle).toMatch(/^staged-/);
				expect(yield* database.run((db) => db.select().from(tables.importCapture))).toHaveLength(0);
				yield* fs.remove(temporary, { recursive: true });
				yield* fs.makeDirectory(temporary);
				yield* activation(
					Effect.gen(function* () {
						const engine = yield* WorkflowEngine;
						const token = DurableDeferred.tokenFromExecutionId(collected, {
							executionId: scope.runId,
							workflow: CollectorCaller,
						});
						yield* DurableDeferred.succeed(collected, { token, value: undefined });
						yield* engine.resume(CollectorCaller, scope.runId);
						yield* waitSuspended(1);
					}),
				);
				expect(collections).toBe(1);
				expect(callerCompletions).toBe(0);
				expect(yield* database.run((db) => db.select().from(tables.importCapture))).toHaveLength(1);
				yield* fs.remove(temporary, { recursive: true });
				yield* fs.makeDirectory(temporary);
				yield* activation(
					Effect.gen(function* () {
						const engine = yield* WorkflowEngine;
						const token = DurableDeferred.tokenFromExecutionId(published, {
							executionId: scope.runId,
							workflow: CollectorCaller,
						});
						yield* DurableDeferred.succeed(published, { token, value: undefined });
						yield* engine.resume(CollectorCaller, scope.runId);
						expect(
							yield* engine.execute(CollectorCaller, {
								executionId: scope.runId,
								payload: { runId: scope.runId },
							}),
						).toBe("page-1");
						const captures = yield* IngestionCaptures;
						expect(new TextDecoder().decode(yield* captures.read(scope, "page-1", 1024))).toBe(
							"collected once",
						);
					}),
				);
				expect(collections).toBe(1);
				expect(callerCompletions).toBe(1);
				expect(yield* database.run((db) => db.select().from(tables.importCapture))).toHaveLength(1);
				const reservations = yield* database.run((db) =>
					db.select().from(tables.importPayloadReservation),
				);
				expect(reservations.filter((row) => row.ordinal === null)).toHaveLength(1);
				expect(reservations.filter((row) => row.ordinal === 64)).toHaveLength(1);
				yield* database.run((db) =>
					db
						.update(tables.importRun)
						.set({ status: "completed" })
						.where(eq(tables.importRun.id, scope.runId)),
				);
				yield* Effect.scoped(
					Layer.build(services).pipe(
						Effect.flatMap((context) =>
							Effect.gen(function* () {
								const captures = yield* IngestionCaptures;
								const repository = yield* ImportsRepository;
								const session = yield* DatabaseSession;
								yield* captures.cleanup(scope);
								yield* session.transaction(repository.purgePayloadReservations(scope));
								expect(
									(yield* Effect.exit(
										captures.stage({
											scope,
											outputIndex: 0,
											ownerExecutionId,
											workflowExecutionId: scope.runId,
											bytes: new TextEncoder().encode("late output"),
											activityExecutionId: `${scope.runId}-COLLECTOR`,
										}),
									))._tag,
								).toBe("Failure");
							}).pipe(Effect.provideContext(context)),
						),
					),
				);
				expect(
					yield* database.run((db) => db.select().from(tables.importPayloadReservation)),
				).toHaveLength(0);
			}),
	);
});
