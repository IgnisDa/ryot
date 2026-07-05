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

const showEntityRef = {
	kind: "resolved",
	externalId: "20",
	sourceLabel: "Lost",
	providerSlug: "show.tmdb",
	entitySchemaSlug: "show",
};

const progressEvent = (occurredAt: string, unresolvedEpisode?: JsonValue) => ({
	occurredAt,
	eventSchemaSlug: "progress",
	properties: { progressPercent: 100 },
	...(unresolvedEpisode === undefined ? {} : { unresolvedEpisode }),
});

const showEpisode = (seasonNumber: number, episodeNumber: number) => ({
	type: "show",
	seasonNumber,
	episodeNumber,
});

const driveWatcharrImport = (input: {
	episodeResults: JsonValue;
	entityGroups: ReadonlyArray<JsonValue>;
	populationResults: ReadonlyArray<JsonValue>;
}) => {
	const journal: JsonValue[] = [];
	const requests: Array<WorkflowReplayEnvelope["requests"][number]> = [];
	const replay = (): Promise<WorkflowReplayEnvelope> =>
		Effect.runPromise(
			workflow.run(
				{ runId: "run-1", source: "watcharr" },
				{ durableCalls: () => Effect.succeed(journal) } satisfies WorkflowSandboxHost,
				{ metadata: {}, sandboxScriptId: "media-import" },
			),
		).then((envelope) => {
			requests.splice(0, requests.length, ...envelope.requests);
			if (envelope.state !== "pending") {
				return envelope;
			}
			const request = envelope.requests[journal.length];
			assert(request);
			if (request.kind === "activity" && request.args.scriptSlug === "activity.import.watcharr") {
				journal.push({
					failures: [],
					totalItems: 1,
					entityGroups: [...input.entityGroups],
				});
			} else if (
				request.kind === "child" &&
				request.args.workflowSlug === "media-import-population"
			) {
				journal.push({ results: [...input.populationResults] });
			} else if (
				request.kind === "activity" &&
				request.args.scriptSlug === "activity.import.resolve-episodes"
			) {
				journal.push(input.episodeResults);
			} else if (
				request.kind === "activity" &&
				request.args.scriptSlug === "activity.import.write-chunks"
			) {
				journal.push({
					totalItems: 1,
					failureCount: 1,
					writeItemCount: 1,
					chunkFiles: ["/tmp/ryot-sandbox-harvest-run/chunk-0.json"],
				});
			} else {
				journal.push({ failedItems: 1, importedItems: 1, processedItems: 2 });
			}
			return replay();
		});

	return { requests, replay };
};

it("fails the workflow rather than dying when a source payload is incomplete", async () => {
	const envelope = await Effect.runPromise(
		workflow.run(
			{ runId: "run-igdb", source: "igdb", sourcePayload: { collection: "  " } },
			{ durableCalls: () => Effect.succeed([]) } satisfies WorkflowSandboxHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		),
	);
	assert(envelope.state === "failed");
	expect(envelope.error).toContain("Import job is missing IGDB collection");
	expect(envelope.requests).toEqual([]);
});

const singleShowGroup = (events: ReadonlyArray<JsonValue>) => [
	{ itemIndex: 0, collectionMemberships: [], entityRef: showEntityRef, events: [...events] },
];

const completedShowPopulation = [{ index: 0, status: "completed", entityId: "show-1" }];

it("deterministically composes Watcharr parsing, population, episode resolution, and kernel writes", async () => {
	const { requests, replay } = driveWatcharrImport({
		populationResults: completedShowPopulation,
		episodeResults: { results: [{ index: 0, entityId: null }] },
		entityGroups: singleShowGroup([progressEvent("2026-01-01T00:00:00.000Z", showEpisode(1, 99))]),
	});

	const envelope = await replay();
	expect(envelope).toMatchObject({
		state: "completed",
		output: { failedItems: 1, importedItems: 1, processedItems: 2 },
	});
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
						index: 0,
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

it("subjects resolved episodes, omits unresolved ones as failures, and keeps sibling events", async () => {
	const { requests, replay } = driveWatcharrImport({
		populationResults: completedShowPopulation,
		entityGroups: singleShowGroup([
			progressEvent("2026-01-01T00:00:00.000Z", showEpisode(1, 1)),
			progressEvent("2026-01-02T00:00:00.000Z", showEpisode(1, 99)),
			{ properties: {}, eventSchemaSlug: "backlog", occurredAt: "2026-01-03T00:00:00.000Z" },
			progressEvent("2026-01-04T00:00:00.000Z", showEpisode(2, 5)),
		]),
		episodeResults: {
			results: [
				{ index: 2, entityId: "episode-5" },
				{ index: 0, entityId: "episode-1" },
				{ index: 1, entityId: null },
			],
		},
	});

	await replay();
	expect(requests[2]).toMatchObject({
		args: {
			input: {
				refs: [
					{ index: 0, kind: "show", showEntityId: "show-1", seasonNumber: 1, episodeNumber: 1 },
					{ index: 1, kind: "show", showEntityId: "show-1", seasonNumber: 1, episodeNumber: 99 },
					{ index: 2, kind: "show", showEntityId: "show-1", seasonNumber: 2, episodeNumber: 5 },
				],
			},
		},
	});

	const writeRequest = requests[3];
	assert(writeRequest?.kind === "activity");
	expect(writeRequest.args.scriptSlug).toBe("activity.import.write-chunks");
	expect(writeRequest.args.input).toMatchObject({
		failures: [
			{
				itemIndex: 0,
				sourceLabel: "Lost",
				sourceIdentifier: "20",
				entitySchemaSlug: "show",
				stage: "provider_resolution",
				message: "Could not resolve show episode S1E99",
			},
		],
		entityGroups: [
			{
				events: [
					{ eventSchemaSlug: "progress", subjectEntityId: "episode-1" },
					{ eventSchemaSlug: "backlog" },
					{ eventSchemaSlug: "progress", subjectEntityId: "episode-5" },
				],
			},
		],
	});
	const writeInput = JSON.stringify(writeRequest.args.input);
	expect(writeInput).not.toContain("unresolvedEpisode");
	expect(writeInput).not.toContain('"subjectEntityId":"show-1"');
});

it("reports the podcast episode that could not be resolved", async () => {
	const { requests, replay } = driveWatcharrImport({
		populationResults: [{ index: 0, status: "completed", entityId: "podcast-1" }],
		episodeResults: { results: [{ index: 0, entityId: null }] },
		entityGroups: [
			{
				itemIndex: 0,
				collectionMemberships: [],
				entityRef: {
					kind: "resolved",
					sourceLabel: "Serial",
					externalId: "917918570",
					providerSlug: "podcast.itunes",
					entitySchemaSlug: "podcast",
				},
				events: [progressEvent("2026-01-01T00:00:00.000Z", { type: "podcast", episodeNumber: 7 })],
			},
		],
	});

	await replay();
	expect(requests[2]).toMatchObject({
		args: { input: { refs: [{ index: 0, kind: "podcast", podcastEntityId: "podcast-1" }] } },
	});
	expect(requests[3]).toMatchObject({
		args: {
			input: {
				entityGroups: [{ events: [] }],
				failures: [
					{
						sourceIdentifier: "917918570",
						entitySchemaSlug: "podcast",
						stage: "provider_resolution",
						message: "Could not resolve podcast episode 7",
					},
				],
			},
		},
	});
});

it.each([
	{
		label: "unexpected",
		error: "Episode resolution returned an unexpected index 5",
		results: [
			{ index: 0, entityId: "episode-1" },
			{ index: 5, entityId: "episode-9" },
		],
	},
	{
		label: "duplicate",
		error: "Episode resolution returned a duplicate index 0",
		results: [
			{ index: 0, entityId: "episode-1" },
			{ index: 0, entityId: "episode-9" },
		],
	},
	{
		label: "missing",
		error: "Episode resolution omitted indices 1",
		results: [{ index: 0, entityId: "episode-1" }],
	},
])("fails the workflow on $label episode result indices", async ({ error, results }) => {
	const { requests, replay } = driveWatcharrImport({
		episodeResults: { results },
		populationResults: completedShowPopulation,
		entityGroups: singleShowGroup([
			progressEvent("2026-01-01T00:00:00.000Z", showEpisode(1, 1)),
			progressEvent("2026-01-02T00:00:00.000Z", showEpisode(1, 2)),
		]),
	});

	const envelope = await replay();
	assert(envelope.state === "failed");
	expect(envelope.error).toContain(error);
	expect(envelope.requests.map(({ kind }) => kind)).toEqual(["activity", "child", "activity"]);
	expect(requests).toHaveLength(3);
});
