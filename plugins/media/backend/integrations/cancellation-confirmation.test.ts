import { afterEach, assert, expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type {
	IngestionActivity,
	IngestionBatch,
} from "@ryot-app/contract/modules/imports/ingestion";
import { IntegrationId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/kernel-backend/lib/test-utils/assertions";
import { makeWorkflowEngine } from "@ryot-app/kernel-backend/lib/test-utils/effect";
import { IngestionCaptures } from "@ryot-app/kernel-backend/modules/imports/capture-service";
import { IngestionExecution } from "@ryot-app/kernel-backend/modules/imports/execution-service";
import {
	ingestionTestDatabase,
	ingestionTestReceipt,
	ingestionTestRun,
	ingestionTestScope,
	ingestionTestSource,
} from "@ryot-app/kernel-backend/modules/imports/ingestion.test-support";
import { ImportsRepository } from "@ryot-app/kernel-backend/modules/imports/repository";
import { ImportSourceStateStore } from "@ryot-app/kernel-backend/modules/imports/runtime/source-state-store";
import { ImportWorkflowPinning } from "@ryot-app/kernel-backend/modules/imports/workflow-pinning";
import {
	IntegrationConfirmationError,
	IntegrationIngestion,
} from "@ryot-app/kernel-backend/modules/integrations/ingestion";
import { AdmittedWorkflowCatalogue } from "@ryot-app/kernel-backend/modules/mutations/workflow-catalogue";
import { IngestionReadinessService } from "@ryot-app/kernel-backend/modules/plugins/ingestion-readiness-service";
import { PluginInstallationRepository } from "@ryot-app/kernel-backend/modules/plugins/installation-repository";
import { SandboxPluginScriptResolver } from "@ryot-app/kernel-backend/modules/sandbox/plugin-script-resolver";
import { SandboxExecutionService } from "@ryot-app/kernel-backend/modules/sandbox/service";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	defineSandboxTestHost,
	makeWorkflowReplayHost,
	runSandboxTestScript,
} from "@ryot-app/sandbox-sdk/testing";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { Layer } from "effect";
import { TestClock } from "effect/testing";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import {
	execution,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../tests/backend/automations/automation-test-utils";
import { createMediaImportChunk } from "../imports/chunks";
import { mediaFilesystem, resetMediaFilesystem } from "../imports/ingestion.test-support";
import root from "../imports/integration.sandbox";
import { YankInput } from "./schemas";
import spotify, { manifest as spotifyManifest } from "./yanks/spotify.sandbox";
import { runYoutubeMusicYank, manifest as youtubeManifest } from "./yanks/youtube-music.sandbox";

afterEach(resetMediaFilesystem);
it.effect.each(["spotify", "youtube-music"] as const)(
	"confirms %s receipts after cancellation, retains pins and captures on confirmation failure, and suppresses or advances the next collection",
	(provider) =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse(execution.startedAt));
			const fs = mediaFilesystem({});
			const saved = new Set<string>();
			let fetched = 0;
			const common = {
				log: () => hostSuccess(null),
				span: () => hostSuccess(null),
				getPersistentValue: (key: string) => hostSuccess(saved.has(key) ? true : null),
				claimPersistentValue: (key: string) => {
					saved.add(key);
					return hostSuccess({ claimed: true as const });
				},
				getCurrentIntegration: () =>
					hostSuccess(
						integrationRecord({ providerSpecifics: { timezone: "UTC", authCookie: "cookie" } }),
					),
			};
			const spotifyHost = defineSandboxTestHost(spotifyManifest, {
				...common,
				getOAuthAccessToken: () =>
					hostSuccess({ accessToken: "token", expiresAt: "2026-01-02T00:00:00Z" }),
				httpCall: () => {
					fetched++;
					return httpSuccess({
						items: [
							{
								played_at: execution.startedAt,
								track: { id: "track", name: "Song", duration_ms: 60000 },
							},
						],
					});
				},
			});
			const youtubeHost = defineSandboxTestHost(youtubeManifest, {
				...common,
				httpCall: () => Effect.die("Injected history owns fetching"),
			});
			const factory = () =>
				Effect.succeed({
					getHistory: () => {
						fetched++;
						return Effect.succeed({
							contents: {
								singleColumnBrowseResultsRenderer: {
									tabs: [
										{
											tabRenderer: {
												content: {
													sectionListRenderer: {
														contents: [
															{
																musicShelfRenderer: {
																	title: { runs: [{ text: "January 1, 2026" }] },
																	contents: [
																		{
																			musicResponsiveListItemRenderer: {
																				playlistItemData: { videoId: "video" },
																				flexColumns: [
																					{
																						musicResponsiveListItemFlexColumnRenderer: {
																							text: { runs: [{ text: "Song" }] },
																						},
																					},
																				],
																			},
																		},
																	],
																},
															},
														],
													},
												},
											},
										},
									],
								},
							},
						});
					},
				});
			const invoke = Effect.fnUntraced(function* (input: typeof YankInput.Type) {
				if (provider === "spotify") {
					return yield* runSandboxTestScript(spotify, input, spotifyHost, execution);
				}
				return yield* runYoutubeMusicYank(input, youtubeHost, execution, factory);
			});
			yield* invoke({});
			const groups = (yield* fs.records()).flatMap(({ group }) => (group ? [group] : []));
			const chunk = createMediaImportChunk(
				{
					failures: [],
					entityGroups: groups,
					populationResults: groups.map((_group, index) => ({
						index,
						entityId: "track",
						status: "completed",
					})),
				},
				execution.startedAt,
			);
			const event = chunk.items[0]?.events[0];
			assert(event);
			const receipt = ingestionTestReceipt(event.operationId, "event:create", {
				processed: [],
				eventId: "committed-event",
			});
			let batch: IngestionBatch = {
				ordinal: 0,
				id: "batch",
				summary: [],
				state: "applying",
				captureId: "application",
				inputFingerprint: "fingerprint",
			};
			let run = ingestionTestRun({
				status: "cancelling",
				executionKind: "integration",
				integrationId: IntegrationId.make("integration-1"),
				plan: {
					operation: "workflow.media-integration",
					selection: { "integration-adapter": `integration.${provider}` },
				},
			});
			const activities = new Map<string, IngestionActivity>();
			let failConfirmation = true;
			let cleaned = false;
			let projections = 0;
			const executions: string[] = [];
			const envelope = {
				rawBody: "--boundary\r\nß original transport\r\n",
				contentType: "multipart/form-data; boundary=boundary",
			};
			const dependencies = Layer.mergeAll(
				ingestionTestDatabase(() => [receipt]),
				Layer.succeed(AdmittedWorkflowCatalogue, []),
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				Layer.mock(IngestionReadinessService)({}),
				Layer.mock(PluginInstallationRepository)({}),
				Layer.mock(SandboxPluginScriptResolver)({}),
				Layer.mock(ImportWorkflowPinning)({ release: () => Effect.void }),
				Layer.mock(ImportSourceStateStore)({
					loadEnvelope: () => Effect.succeed(envelope),
					materialize: () => Effect.succeed(ingestionTestSource),
				}),
				Layer.mock(IngestionCaptures)({
					stopWrites: () => Effect.void,
					cleanup: () =>
						Effect.sync(() => {
							expect(saved.size).toBe(1);
							cleaned = true;
						}),
					read: () =>
						Schema.encodeEffect(Schema.fromJsonString(jsonValueSchema))(chunk).pipe(
							Effect.map((text) => Buffer.from(text)),
							Effect.orDie,
						),
				}),
				Layer.mock(ImportsRepository)({
					getOutcome: () => Effect.succeed(null),
					getBatchIssues: () => Effect.succeed([]),
					listBatchExecutions: () => Effect.succeed([]),
					finishActivities: () => Effect.succeed("cancelled"),
					listBatches: () => Effect.sync(() => [{ data: batch }]),
					getIngestionRun: () =>
						Effect.sync(() => ({ ...run, activities: [...activities.values()] })),
					releaseIngestionPins: () =>
						Effect.sync(() => {
							run = { ...run, pins: null };
							return true;
						}),
					settleIngestion: (input) =>
						Effect.sync(() => {
							run = { ...run, status: input.status };
							return true;
						}),
					projectBatch: (_scope, updated) =>
						Effect.sync(() => {
							projections++;
							batch = updated;
							run = { ...run, summary: updated.summary };
							return true;
						}),
					putSettlementActivity: (_scope, activity) =>
						Effect.sync(() => {
							expect(run.status).toBe("cancelling");
							activities.set(activity.id, activity);
							return undefined;
						}),
					getIntegrationInput: () =>
						Effect.succeed({
							lot: "sink",
							envelope: {
								ordinal: 33,
								state: "sealed",
								checkpoint: null,
								phase: "collection",
								id: "admitted-envelope",
								payload: { byteSize: 100, locator: "envelope", checksum: "checksum" },
							},
						}),
				}),
				Layer.mock(SandboxExecutionService)({
					executeWorkflow: (input) =>
						Effect.gen(function* () {
							expect(input.scriptId).toBe(run.pins?.scriptId);
							expect(input.pluginRevision).toEqual(ingestionTestSource.pluginRevision);
							expect(input.subject).toEqual({
								type: "user",
								integrationId: run.integrationId,
								userId: ingestionTestScope.userId,
								integrationRunId: ingestionTestScope.runId,
								accountGeneration: ingestionTestScope.accountGeneration,
							});
							executions.push(input.executionId);
							if (failConfirmation) {
								failConfirmation = false;
								return yield* new SandboxRunError({
									kind: "script-failure",
									message: "confirmation unavailable",
								});
							}
							const decoded = yield* Schema.decodeUnknownEffect(root.input)(input.input);
							assert("ingestionConfirmation" in decoded);
							expect(decoded.integrationContext).toEqual(envelope);
							const first = yield* root.run(decoded, makeWorkflowReplayHost([]), execution);
							assert(first.state === "pending");
							const request = first.requests[0];
							assert(request?.kind === "activity");
							expect(request.args.scriptSlug).toBe(`integration.${provider}`);
							expect(request.args.input).toMatchObject(envelope);
							yield* invoke(yield* Schema.decodeUnknownEffect(YankInput)(request.args.input));
							const done = yield* root.run(
								decoded,
								makeWorkflowReplayHost([{ request, value: { chunkHandles: [] } }]),
								execution,
							);
							assert(done.state === "completed");
							return done.output;
						}).pipe(
							Effect.mapError(
								(error) => new SandboxRunError({ kind: "script-failure", message: error.message }),
							),
						),
				}),
			);
			const context = yield* Layer.build(
				IntegrationIngestion.layer.pipe(
					Layer.provideMerge(
						Layer.effect(IngestionExecution, IngestionExecution.make).pipe(
							Layer.provideMerge(dependencies),
						),
					),
				),
			);
			const ingestion = yield* Effect.provideContext(IntegrationIngestion, context);
			assertExitFails(
				yield* Effect.exit(ingestion.settle(ingestionTestScope, "cancelled")),
				new IntegrationConfirmationError({
					message: "Integration source confirmation did not complete",
				}),
			);
			expect(run.status).toBe("cancelling");
			expect(run.pins).not.toBeNull();
			expect(cleaned).toBe(false);
			expect(saved.size).toBe(0);
			expect(batch.state).toBe("applied");
			expect([...activities.values()]).toMatchObject([{ completed: 1, state: "running" }]);
			expect(yield* ingestion.settle(ingestionTestScope, "cancelled")).toBe(true);
			expect(run.status).toBe("cancelled");
			expect(cleaned).toBe(true);
			expect(run.pins).toBeNull();
			expect(new Set(executions).size).toBe(2);
			expect(projections).toBe(1);
			expect([...activities.values()]).toMatchObject([{ completed: 2, state: "completed" }]);
			expect(fetched).toBe(1);
			fs.scratch.clear();
			const nextOutput = yield* invoke({});
			const next = yield* fs.records();
			if (provider === "spotify") {
				expect(nextOutput.chunkFiles).toEqual([]);
				expect(next).toHaveLength(0);
			} else {
				expect(next[0]?.group?.events[0]?.properties["progressPercent"]).toBe(100);
			}
		}),
);
