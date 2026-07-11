import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { WorkflowReplayEnvelope, WorkflowReplayHost } from "@ryot-app/sandbox-sdk/workflow";
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
		expect(mediaImportParser(source).scriptSlug).toBe(`import.${source}`);
	}
});

it("passes Netflix profile selection from source payload to its parser activity", async () => {
	const envelope = await Effect.runPromise(
		workflow.run(
			{ source: "netflix", runId: "run-netflix", sourcePayload: { profileName: "Kids" } },
			{ replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		),
	);
	expect(envelope).toMatchObject({
		state: "pending",
		requests: [
			{
				kind: "activity",
				args: { scriptSlug: "import.netflix", input: { start: 0, limit: 25, profileName: "Kids" } },
			},
		],
	});
});

it.each([
	["user mode", { mode: "user", username: "alice" }, { mode: "user", username: "alice" }],
	[
		"list mode",
		{ mode: "list", collection: "Favorites", url: "https://trakt.tv/users/alice/lists/favorites" },
		{ mode: "list", collection: "Favorites", url: "https://trakt.tv/users/alice/lists/favorites" },
	],
	[
		"export mode",
		{ mode: "export", exportUploadToken: "exportUploadToken" },
		{ mode: "export", hasExportFile: true },
	],
])("passes Trakt $0 fields to its parser activity", async (_, sourcePayload, input) => {
	const envelope = await Effect.runPromise(
		workflow.run(
			{ sourcePayload, source: "trakt", runId: `run-trakt-${_}` },
			{ replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		),
	);
	expect(envelope).toMatchObject({
		state: "pending",
		requests: [
			{
				kind: "activity",
				args: { scriptSlug: "import.trakt", input: { start: 0, limit: 25, ...input } },
			},
		],
	});
});

it("passes credentialed source payload fields to its parser activity", async () => {
	const envelope = await Effect.runPromise(
		workflow.run(
			{
				source: "plex",
				runId: "run-plex",
				sourcePayload: {
					apiKey: "token",
					apiUrl: "https://plex.example",
					allowInsecureConnections: true,
				},
			},
			{ replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		),
	);
	expect(envelope).toMatchObject({
		requests: [
			{
				kind: "activity",
				args: {
					scriptSlug: "import.plex",
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

it("selects optional MyAnimeList artifacts from source payload field markers", async () => {
	const envelope = await Effect.runPromise(
		workflow.run(
			{
				runId: "run-mal",
				source: "myanimelist",
				sourcePayload: { mangaUploadToken: "mangaUploadToken" },
			},
			{ replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		),
	);
	expect(envelope).toMatchObject({
		requests: [
			{
				kind: "activity",
				args: {
					scriptSlug: "import.myanimelist",
					input: { start: 0, limit: 25, hasMangaFile: true, hasAnimeFile: false },
				},
			},
		],
	});
});

it("marks adapter-only integration failures as failed kernel runs", async () => {
	const journal: JsonValue[] = [];
	const input = {
		source: "kodi",
		runId: "run-kodi",
		sourcePayload: {
			integrationId: "integration-1",
			integrationScriptSlug: "integration.kodi",
			integrationContext: { rawBody: "{}", contentType: "application/json" },
		},
	};
	const replay = () =>
		Effect.runPromise(
			workflow.run(
				input,
				{ replayJournal: () => Effect.succeed(journal) } satisfies WorkflowReplayHost,
				{ metadata: {}, sandboxScriptId: "media-import" },
			),
		);

	let envelope = await replay();
	expect(envelope).toMatchObject({
		state: "pending",
		requests: [{ kind: "activity", args: { scriptSlug: "integration.kodi" } }],
	});
	journal.push({
		entityGroups: [],
		failures: [{ itemIndex: 0, message: "Invalid payload", stage: "input_transformation" }],
	});

	envelope = await replay();
	const chunkRequest = envelope.requests[journal.length];
	assert(chunkRequest?.kind === "activity");
	expect(chunkRequest.args.scriptSlug).toBe("import.write-chunks");
	journal.push({
		totalItems: 1,
		failureCount: 1,
		writeItemCount: 0,
		chunkHandles: ["harvest-handle-0"],
	});

	envelope = await replay();
	const kernelRequest = envelope.requests[journal.length];
	assert(kernelRequest?.kind === "child");
	expect(kernelRequest.args).toMatchObject({
		workflowSlug: "kernel:process-import-chunks",
		input: { failRun: true, integrationId: "integration-1" },
	});
});

const showEntityRef = {
	kind: "resolved",
	externalId: "20",
	sourceLabel: "Lost",
	entitySchemaSlug: "show",
	providerSlug: "show.tmdb",
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
				{ replayJournal: () => Effect.succeed(journal) } satisfies WorkflowReplayHost,
				{ metadata: {}, sandboxScriptId: "media-import" },
			),
		).then((envelope) => {
			requests.splice(0, requests.length, ...envelope.requests);
			if (envelope.state !== "pending") {
				return envelope;
			}
			const request = envelope.requests[journal.length];
			assert(request);
			if (request.kind === "activity" && request.args.scriptSlug === "import.watcharr") {
				journal.push({ failures: [], totalItems: 1, entityGroups: [...input.entityGroups] });
			} else if (
				request.kind === "child" &&
				request.args.workflowSlug === "media-import-population"
			) {
				journal.push({ results: [...input.populationResults] });
			} else if (
				request.kind === "activity" &&
				request.args.scriptSlug === "import.resolve-episodes"
			) {
				journal.push(input.episodeResults);
			} else if (request.kind === "activity" && request.args.scriptSlug === "import.write-chunks") {
				journal.push({
					totalItems: 1,
					failureCount: 1,
					writeItemCount: 1,
					chunkHandles: ["harvest-handle-0"],
				});
			} else {
				journal.push({ failedItems: 1, importedItems: 1, processedItems: 2 });
			}
			return replay();
		});

	return { replay, requests };
};

it("fails the workflow rather than dying when a source payload is incomplete", async () => {
	const envelope = await Effect.runPromise(
		workflow.run(
			{ source: "igdb", runId: "run-igdb", sourcePayload: { collection: "  " } },
			{ replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		),
	);
	assert(envelope.state === "failed");
	expect(envelope.error).toContain("Import job is missing IGDB collection");
	expect(envelope.requests).toEqual([]);
});

it.each([
	["missing mode", {}, "Import job is missing or invalid Trakt mode"],
	[
		"legacy username-only payload",
		{ username: "alice" },
		"Import job is missing or invalid Trakt mode",
	],
	["missing user username", { mode: "user" }, "Import job is missing Trakt username"],
	[
		"blank user username",
		{ mode: "user", username: "   " },
		"Import job is missing Trakt username",
	],
	[
		"missing list URL",
		{ mode: "list", collection: "Favorites" },
		"Import job is missing or invalid Trakt list URL",
	],
	[
		"invalid list URL",
		{ mode: "list", url: "not-a-url", collection: "Favorites" },
		"Import job is missing or invalid Trakt list URL",
	],
	[
		"missing list collection",
		{ mode: "list", url: "https://trakt.tv/lists/favorites" },
		"Import job is missing Trakt collection",
	],
	[
		"blank list collection",
		{ mode: "list", collection: "   ", url: "https://trakt.tv/users/alice/lists/favorites" },
		"Import job is missing Trakt collection",
	],
	[
		"invalid mode",
		{ mode: "other", username: "alice" },
		"Import job is missing or invalid Trakt mode",
	],
	["missing export ZIP", { mode: "export" }, "Import job is missing Trakt export ZIP"],
])("fails the Trakt workflow on $0", async (_, sourcePayload, error) => {
	const envelope = await Effect.runPromise(
		workflow.run(
			{ sourcePayload, source: "trakt", runId: "run-trakt-invalid" },
			{ replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		),
	);
	assert(envelope.state === "failed");
	expect(envelope.error).toContain(error);
	expect(envelope.requests).toEqual([]);
});

const singleShowGroup = (events: ReadonlyArray<JsonValue>) => [
	{ itemIndex: 0, events: [...events], entityRef: showEntityRef, collectionMemberships: [] },
];

const completedShowPopulation = [{ index: 0, entityId: "show-1", status: "completed" }];

it("deterministically composes Watcharr parsing, population, episode resolution, and kernel writes", async () => {
	const { replay, requests } = driveWatcharrImport({
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
			scriptSlug: "import.resolve-episodes",
			input: {
				refs: [
					{ index: 0, kind: "show", seasonNumber: 1, episodeNumber: 99, showEntityId: "show-1" },
				],
			},
		},
	});
});

it("subjects resolved episodes, omits unresolved ones as failures, and keeps sibling events", async () => {
	const { replay, requests } = driveWatcharrImport({
		populationResults: completedShowPopulation,
		episodeResults: {
			results: [
				{ index: 2, entityId: "episode-5" },
				{ index: 0, entityId: "episode-1" },
				{ index: 1, entityId: null },
			],
		},
		entityGroups: singleShowGroup([
			progressEvent("2026-01-01T00:00:00.000Z", showEpisode(1, 1)),
			progressEvent("2026-01-02T00:00:00.000Z", showEpisode(1, 99)),
			{ properties: {}, eventSchemaSlug: "backlog", occurredAt: "2026-01-03T00:00:00.000Z" },
			progressEvent("2026-01-04T00:00:00.000Z", showEpisode(2, 5)),
		]),
	});

	await replay();
	expect(requests[2]).toMatchObject({
		args: {
			input: {
				refs: [
					{ index: 0, kind: "show", seasonNumber: 1, episodeNumber: 1, showEntityId: "show-1" },
					{ index: 1, kind: "show", seasonNumber: 1, episodeNumber: 99, showEntityId: "show-1" },
					{ index: 2, kind: "show", seasonNumber: 2, episodeNumber: 5, showEntityId: "show-1" },
				],
			},
		},
	});

	const writeRequest = requests[3];
	assert(writeRequest?.kind === "activity");
	expect(writeRequest.args.scriptSlug).toBe("import.write-chunks");
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
	const { replay, requests } = driveWatcharrImport({
		episodeResults: { results: [{ index: 0, entityId: null }] },
		populationResults: [{ index: 0, status: "completed", entityId: "podcast-1" }],
		entityGroups: [
			{
				itemIndex: 0,
				collectionMemberships: [],
				events: [progressEvent("2026-01-01T00:00:00.000Z", { type: "podcast", episodeNumber: 7 })],
				entityRef: {
					kind: "resolved",
					sourceLabel: "Serial",
					externalId: "917918570",
					entitySchemaSlug: "podcast",
					providerSlug: "podcast.itunes",
				},
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
						entitySchemaSlug: "podcast",
						stage: "provider_resolution",
						sourceIdentifier: "917918570",
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
	const { replay, requests } = driveWatcharrImport({
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
