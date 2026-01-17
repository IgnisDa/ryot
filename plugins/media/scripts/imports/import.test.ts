import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import type { WorkflowReplayEnvelope, WorkflowSandboxHost } from "@ryot/sandbox-sdk/workflow";
import { Effect } from "effect";
import { assert, expect, it } from "vitest";

import workflow, { mediaImportParser } from "./import.sandbox";

it("dispatches every declared source to its matching parser activity", () => {
	for (const source of [
		"goodreads",
		"storygraph",
		"hardcover",
		"anilist",
		"trakt",
		"imdb",
		"igdb",
		"grouvee",
		"watcharr",
		"netflix",
		"movary",
		"myanimelist",
		"jellyfin",
		"plex",
		"audiobookshelf",
		"media_tracker",
	]) {
		expect(mediaImportParser(source).scriptSlug).toBe(`activity.import.${source}`);
	}
});

it("passes Netflix profile selection from source payload to its parser activity", async () => {
	const envelope = await Effect.runPromise(
		workflow.run(
			{ runId: "run-netflix", source: "netflix", sourcePayload: { profileName: "Kids" } },
			{ durableCalls: () => Effect.succeed([]) } satisfies WorkflowSandboxHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		),
	);
	expect(envelope).toMatchObject({
		state: "pending",
		requests: [
			{
				kind: "activity",
				args: {
					scriptSlug: "activity.import.netflix",
					input: { start: 0, limit: 25, profileName: "Kids" },
				},
			},
		],
	});
});

it("passes credentialed source payload fields to its parser activity", async () => {
	const envelope = await Effect.runPromise(
		workflow.run(
			{
				runId: "run-plex",
				source: "plex",
				sourcePayload: {
					apiKey: "token",
					apiUrl: "https://plex.example",
					allowInsecureConnections: true,
				},
			},
			{ durableCalls: () => Effect.succeed([]) } satisfies WorkflowSandboxHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		),
	);
	expect(envelope).toMatchObject({
		requests: [
			{
				kind: "activity",
				args: {
					scriptSlug: "activity.import.plex",
					input: {
						start: 0,
						limit: 25,
						apiKey: "token",
						apiUrl: "https://plex.example",
						allowInsecureConnections: true,
					},
				},
			},
		],
	});
});

it("selects optional MyAnimeList artifacts from source payload path identities", async () => {
	const envelope = await Effect.runPromise(
		workflow.run(
			{
				runId: "run-mal",
				source: "myanimelist",
				sourcePayload: { mangaFilePath: "/tmp/manga.xml" },
			},
			{ durableCalls: () => Effect.succeed([]) } satisfies WorkflowSandboxHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		),
	);
	expect(envelope).toMatchObject({
		requests: [
			{
				kind: "activity",
				args: {
					scriptSlug: "activity.import.myanimelist",
					input: { start: 0, limit: 25, hasAnimeFile: false, hasMangaFile: true },
				},
			},
		],
	});
});

it("deterministically composes Watcharr parsing, population, episode resolution, and kernel writes", async () => {
	const journal: JsonValue[] = [];
	const requests: Array<WorkflowReplayEnvelope["requests"][number]> = [];
	const replay = (): Promise<JsonValue> =>
		Effect.runPromise(
			workflow.run(
				{ runId: "run-1", source: "watcharr" },
				{ durableCalls: () => Effect.succeed(journal) } satisfies WorkflowSandboxHost,
				{ metadata: {}, sandboxScriptId: "media-import" },
			),
		).then((envelope) => {
			requests.splice(0, requests.length, ...envelope.requests);
			if (envelope.state === "completed") {
				return envelope.output;
			}
			if (envelope.state === "failed") {
				throw new Error(envelope.error);
			}
			const request = envelope.requests[journal.length];
			assert(request);
			if (request.kind === "activity" && request.args.scriptSlug === "activity.import.watcharr") {
				journal.push({
					failures: [],
					totalItems: 1,
					entityGroups: [
						{
							itemIndex: 0,
							collectionMemberships: [],
							entityRef: {
								kind: "resolved",
								externalId: "20",
								sourceLabel: "Lost",
								providerSlug: "show.tmdb",
								entitySchemaSlug: "show",
							},
							events: [
								{
									occurredAt: "2026-01-01T00:00:00.000Z",
									eventSchemaSlug: "progress",
									properties: { progressPercent: 100 },
									episodeLocator: {
										type: "show",
										seasonNumber: 1,
										episodeNumber: 99,
									},
								},
							],
						},
					],
				});
			} else if (
				request.kind === "child" &&
				request.args.workflowSlug === "media-import-population"
			) {
				journal.push({ results: [{ index: 0, status: "completed", entityId: "show-1" }] });
			} else if (
				request.kind === "activity" &&
				request.args.scriptSlug === "activity.import.resolve-episodes"
			) {
				journal.push({ results: [{ entityId: null }] });
			} else if (
				request.kind === "activity" &&
				request.args.scriptSlug === "activity.import.write-chunks"
			) {
				journal.push({
					totalItems: 1,
					failureCount: 1,
					writeItemCount: 0,
					chunkFiles: ["/tmp/ryot-sandbox-harvest-run/chunk-0.json"],
				});
			} else {
				journal.push({ failedItems: 1, importedItems: 0, processedItems: 1 });
			}
			return replay();
		});

	const result = await replay();
	expect(result).toEqual({ failedItems: 1, importedItems: 0, processedItems: 1 });
	expect(requests.map(({ kind }) => kind)).toEqual([
		"activity",
		"child",
		"activity",
		"activity",
		"child",
	]);
	expect(requests[1]).toMatchObject({
		args: {
			workflowSlug: "media-import-population",
			input: {
				items: [
					expect.objectContaining({
						index: 0,
						providerSlug: "show.tmdb",
						origin: { kind: "import", importRunId: "run-1" },
					}),
				],
			},
		},
	});
	expect(requests[2]).toMatchObject({
		args: {
			scriptSlug: "activity.import.resolve-episodes",
			input: {
				refs: [
					{
						kind: "show",
						showEntityId: "show-1",
						seasonNumber: 1,
						episodeNumber: 99,
					},
				],
			},
		},
	});
});
