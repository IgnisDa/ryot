import { assert, expect, it } from "@effect/vitest";
import { genericImportKernelInputSchema } from "@ryot-app/sandbox-sdk/imports";
import { makeWorkflowReplayHost } from "@ryot-app/sandbox-sdk/testing";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";
import {
	selectExecutable,
	type WorkflowReplayEnvelope,
	type WorkflowReplayJournalEntry,
} from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";

import workflow from "./import.sandbox";
import { mediaImportTestCommand } from "./ingestion.test-support";
import { mediaSources } from "./references";

it("declares all 17 source collectors and a distinct Trakt archive collector", () => {
	for (const source of [
		"anilist",
		"audiobookshelf",
		"goodreads",
		"grouvee",
		"hardcover",
		"imdb",
		"igdb",
		"jellyfin",
		"media_tracker",
		"movary",
		"myanimelist",
		"netflix",
		"plex",
		"spotify",
		"storygraph",
		"trakt",
		"watcharr",
	]) {
		expect(selectExecutable(mediaSources, source).scriptSlug).toBe(`import.${source}`);
	}
	expect(selectExecutable(mediaSources, "trakt-export").scriptSlug).toBe("import.trakt-export");
});
it.live(
	"collects two source windows once, publishes checkpoints, and uses the persisted seal summary",
	() =>
		Effect.gen(function* () {
			const input = {
				runId: "run",
				source: "goodreads",
				sourcePayloadHandle: "settings",
				command: mediaImportTestCommand(),
				plan: { operation: "import", selection: { "source-parser": "goodreads" } },
			};
			const journal: WorkflowReplayJournalEntry[] = [];
			const requests: Array<WorkflowReplayEnvelope["requests"][number]> = [];
			const record = (request: WorkflowReplayEnvelope["requests"][number], value: JsonValue) =>
				journal.push({ value, request });
			const summary = [
				{
					unit: "events",
					recordKind: "review",
					counts: { created: 9, updated: 0, skipped: 2, unchanged: 0, unsuccessful: 1 },
				},
			];
			let collections = 0;
			let envelope: WorkflowReplayEnvelope;
			for (;;) {
				envelope = yield* workflow.run(input, makeWorkflowReplayHost(journal), {
					metadata: {},
					sandboxScriptId: "media-import",
				});
				if (envelope.state !== "pending") {
					break;
				}
				const request = envelope.requests[journal.length];
				assert(request);
				requests.push(request);
				if (request.kind === "activity") {
					assert(request.args.scriptSlug === "import.control");
					record(request, { next: null, entries: [], settings: {} });
				} else {
					assert(request.kind === "child");
					if (request.args.workflowSlug === "media-import-collection") {
						collections++;
						record(request, {
							eventOffset: 0,
							step: collections,
							header: "Title,ISBN",
							done: collections === 2,
							offset: collections * 100,
							itemIndex: collections * 5,
							ordinal: 64 + collections * 2,
							advancedAt: input.command.occurredAt,
							carry: collections === 1 ? "source-0-carry" : null,
							run: { pages: 1, prefix: `source-${collections}` },
						});
					} else if (request.args.workflowSlug === "media-import-merge") {
						record(request, {
							page: 2,
							done: true,
							leftPage: 0,
							ordinal: 70,
							rightPage: 0,
							leftOffset: 1,
							rightOffset: 1,
						});
					} else if (request.args.workflowSlug === "media-import-application") {
						record(request, {
							page: 2,
							batch: 4,
							offset: 0,
							done: true,
							issues: [],
							ordinal: 80,
							itemIndex: 10,
							dedupKey: null,
						});
					} else {
						const { operation } = yield* Schema.decodeUnknownEffect(genericImportKernelInputSchema)(
							request.args.input,
						);
						if (operation.action === "capture") {
							record(request, {
								handle: operation.handle,
								captureId: operation.captureId,
								inputFingerprint: "fingerprint",
							});
						} else if (operation.action === "seal") {
							record(request, { summary, sealed: true });
						} else {
							record(request, { recorded: true });
						}
					}
				}
			}
			assert(envelope.state === "completed");
			expect(envelope.output).toEqual({ summary, issues: [] });
			expect(collections).toBe(2);
			const collectionInputs = requests.flatMap((request) =>
				request.kind === "child" && request.args.workflowSlug === "media-import-collection"
					? [request.args.input]
					: [],
			);
			expect(collectionInputs[1]).toMatchObject({
				offset: 100,
				itemIndex: 5,
				carry: "source-0-carry",
			});
			expect(
				requests.filter(
					(request) =>
						request.kind === "child" && request.args.workflowSlug === "media-import-application",
				),
			).toHaveLength(1);
		}),
);
