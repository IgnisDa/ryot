import { assert, expect, it } from "@effect/vitest";
import { makeWorkflowReplayHost } from "@ryot-app/plugin-backend-sdk/testing";
import {
	defineManifest,
	defineWorkflow,
	Effect,
	Schema,
	type WorkflowReplayJournalEntry,
} from "@ryot-app/plugin-backend-sdk/workflow";

import { runMediaImportBatch } from "./batch";
import { mediaImportTestCommand } from "./ingestion.test-support";
import { MediaImportAdapterBatch } from "./schemas";

const workflow = defineWorkflow({
	input: MediaImportAdapterBatch,
	output: Schema.Struct({ chunkHandles: Schema.Array(Schema.String) }),
	manifest: defineManifest({
		kind: "workflow",
		slug: "test.media-batch",
		name: "Media batch test",
	}),
	run: (batch, replay) =>
		Effect.gen(function* () {
			return yield* runMediaImportBatch(replay, {
				batch,
				runId: "run",
				batchIndex: 0,
				integrationId: "integration",
				command: mediaImportTestCommand(),
			});
		}),
});

it.live.each(["episode-1", null])(
	"applies a podcast title resolution of %s to its episode only",
	(entityId) =>
		Effect.gen(function* () {
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
								properties: { progressPercent: 42, consumedOn: "audiobookshelf" },
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
);
