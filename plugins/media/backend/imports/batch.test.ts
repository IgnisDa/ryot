import { expect } from "bun:test";

import { makeWorkflowReplayHost } from "@ryot-app/plugin-backend-sdk/testing";
import {
	defineManifest,
	defineWorkflow,
	Effect,
	Schema,
} from "@ryot-app/plugin-backend-sdk/workflow";
import type { WorkflowReplayJournalEntry } from "@ryot-app/plugin-backend-sdk/workflow/protocol";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { runMediaImportBatch } from "./batch";
import { mediaImportTestCommand } from "./ingestion.test-support";
import { MediaImportAdapterBatch } from "./schemas";

const makeWorkflow = (integrationId?: string) =>
	defineWorkflow({
		input: MediaImportAdapterBatch,
		output: Schema.Struct({ chunkHandles: Schema.Array(Schema.String) }),
		manifest: defineManifest({
			kind: "workflow",
			slug: "test.media-batch",
			name: "Media batch test",
		}),
		run: (batch, replay) =>
			Effect.gen(function* () {
				return {
					output: yield* runMediaImportBatch(replay, {
						batch,
						runId: "run",
						batchIndex: 0,
						...(integrationId === undefined ? {} : { integrationId }),
						command: mediaImportTestCommand(),
					}),
				};
			}),
	});

it.live.each([
	{ entityId: "episode-1", integrationId: "integration" },
	{ entityId: null, integrationId: "integration" },
	{ entityId: "episode-1", integrationId: undefined },
])(
	"applies podcast resolution and namespaces manual import identity: %s",
	({ entityId, integrationId }) =>
		Effect.gen(function* () {
			const workflow = makeWorkflow(integrationId);
			const journal: WorkflowReplayJournalEntry[] = [];
			const input: typeof MediaImportAdapterBatch.Type = {
				failures: [],
				totalItems: 1,
				entityGroups: [
					{
						itemIndex: 7,
						collectionMemberships: [],
						entityRef: {
							kind: "resolved",
							externalId: "42",
							sourceLabel: "Podcast",
							entitySchemaSlug: "podcast",
							providerSlug: "podcast.itunes",
						},
						events: [
							{
								sourceItemIndex: 7,
								eventSchemaSlug: "progress",
								operationId: "source-episode",
								occurredAt: "2026-01-01T00:00:00.000Z",
								properties: { progressPercent: 42, consumedOn: ["audiobookshelf"] },
								unresolvedEpisode: { type: "podcast-title", episodeTitle: "Pilot" },
								attribution: {
									recordId: "episode",
									sourceLabel: "Podcast",
									sourceIdentifier: "podcast/episode",
								},
							},
						],
					},
				],
			};
			let resolved = false;
			let written = false;
			for (;;) {
				const envelope = yield* workflow.run(input, makeWorkflowReplayHost(journal), {
					metadata: {},
					sandboxScriptId: "batch-test",
				});
				if (envelope.state !== "pending") {
					expect(envelope.state).toBe("completed");
					break;
				}
				const request = envelope.requests[journal.length];
				assert(request);
				if (request.kind === "child") {
					expect(request.args.workflowSlug).toBe("media-import-population");
					journal.push({
						request,
						value: { results: [{ index: 0, status: "completed", entityId: "podcast-1" }] },
					});
					continue;
				}
				assert(request.kind === "activity");
				if (request.args.scriptSlug === "import.resolve-episodes") {
					expect(request.args.input).toEqual({
						refs: [
							{
								index: 0,
								kind: "podcast-title",
								episodeTitle: "Pilot",
								podcastEntityId: "podcast-1",
							},
						],
					});
					resolved = true;
					journal.push({ request, value: { results: [{ index: 0, entityId }] } });
				} else {
					expect(request.args.scriptSlug).toBe("import.write-chunks");
					expect(request.args.input).toMatchObject(
						entityId
							? {
									failures: [],
									entityGroups: [
										{
											events: [
												{
													subjectEntityId: entityId,
													operationId: "source-episode",
													subjectEntitySchemaSlug: "podcast-episode",
													properties: {
														progressPercent: 42,
														consumedOn: ["audiobookshelf"],
														...(integrationId === undefined
															? { sourceRun: "run:source-episode" }
															: {}),
													},
												},
											],
										},
									],
								}
							: {
									entityGroups: [{ events: [] }],
									failures: [
										{
											stage: "provider_resolution",
											operationId: "source-episode",
											message: "Could not resolve podcast episode Pilot",
										},
									],
								},
					);
					written = true;
					journal.push({ request, value: { chunkHandles: ["chunk"] } });
				}
			}
			expect(resolved && written).toBe(true);
		}),
	testTimeout,
);

const showEpisodeEvent = (operationId: string, seasonNumber: number, episodeNumber: number) => ({
	operationId,
	sourceItemIndex: 7,
	eventSchemaSlug: "complete",
	occurredAt: "2024-01-02T00:00:00.000Z",
	properties: { sourceRun: JSON.stringify([7, `seen:${operationId}`]) },
	unresolvedEpisode: { seasonNumber, episodeNumber, type: "show" as const },
	attribution: { recordId: "7", sourceIdentifier: "1399", sourceLabel: "Synthetic Show" },
});

it.live(
	"populates a show before resolving history episodes and reports an episode it still lacks",
	() =>
		Effect.gen(function* () {
			const workflow = makeWorkflow();
			const journal: WorkflowReplayJournalEntry[] = [];
			const input: typeof MediaImportAdapterBatch.Type = {
				failures: [],
				totalItems: 1,
				entityGroups: [
					{
						itemIndex: 7,
						collectionMemberships: [],
						events: [showEpisodeEvent("present", 2, 1), showEpisodeEvent("missing", 9, 1)],
						entityRef: {
							kind: "resolved",
							externalId: "1399",
							entitySchemaSlug: "show",
							providerSlug: "show.tmdb",
							sourceLabel: "Synthetic Show",
						},
					},
				],
			};
			const requests: string[] = [];
			for (;;) {
				const envelope = yield* workflow.run(input, makeWorkflowReplayHost(journal), {
					metadata: {},
					sandboxScriptId: "batch-test",
				});
				if (envelope.state !== "pending") {
					expect(envelope.state).toBe("completed");
					break;
				}
				const request = envelope.requests[journal.length];
				assert(request);
				if (request.kind === "child") {
					requests.push(request.args.workflowSlug);
					expect(request.args.input).toMatchObject({
						items: [{ index: 0, externalId: "1399", providerSlug: "show.tmdb" }],
					});
					journal.push({
						request,
						value: { results: [{ index: 0, entityId: "show-1", status: "completed" }] },
					});
					continue;
				}
				assert(request.kind === "activity");
				requests.push(request.args.scriptSlug);
				if (request.args.scriptSlug === "import.resolve-episodes") {
					expect(request.args.input).toEqual({
						refs: [
							{ index: 0, kind: "show", seasonNumber: 2, episodeNumber: 1, showEntityId: "show-1" },
							{ index: 1, kind: "show", seasonNumber: 9, episodeNumber: 1, showEntityId: "show-1" },
						],
					});
					journal.push({
						request,
						value: {
							results: [
								{ index: 0, entityId: "episode-2-1" },
								{ index: 1, entityId: null },
							],
						},
					});
					continue;
				}
				expect(request.args.input).toMatchObject({
					failures: [
						{
							operationId: "missing",
							stage: "provider_resolution",
							message: "Could not resolve show episode S9E1",
						},
					],
					entityGroups: [
						{
							events: [
								{
									operationId: "present",
									subjectEntityId: "episode-2-1",
									subjectEntitySchemaSlug: "show-episode",
									properties: { sourceRun: 'run:[7,"seen:present"]' },
								},
							],
						},
					],
				});
				journal.push({ request, value: { chunkHandles: ["chunk"] } });
			}
			expect(requests).toEqual([
				"media-import-population",
				"import.resolve-episodes",
				"import.write-chunks",
			]);
		}),
	testTimeout,
);
