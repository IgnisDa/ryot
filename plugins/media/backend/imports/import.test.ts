import { assert, expect, it } from "@effect/vitest";
import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { WorkflowReplayEnvelope, WorkflowReplayHost } from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";

import segmentWorkflow from "../workflows/media-import-segment.sandbox";
import { mediaImportParser, MediaImportSegmentInput } from "./batch";
import workflow from "./import.sandbox";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const importCommand = (runId: string, integrationId?: string) =>
	Schema.decodeSync(LifecycleCommand)({
		occurredAt: "2026-09-16T00:00:00.000Z",
		itemIdentity: encodeJson(["import-run", runId]),
		accountGeneration: { userId: "user-1", token: "test-account-generation" },
		causation: {
			depth: 0,
			parentRunId: null,
			importRunId: runId,
			parentTriggerId: null,
			executionId: `execution-${runId}`,
			rootExecutionId: `execution-${runId}`,
			...(integrationId
				? {
						integrationId,
						source: "integration",
						initiator: { id: integrationId, kind: "integration" },
					}
				: { source: "import", initiator: { id: "user-1", kind: "user" } }),
		},
	});

const emptyJournal = { replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost;
const execution = { metadata: {}, sandboxScriptId: "media-import" };

const parserRequest = (input: {
	runId: string;
	source: string;
	sourcePayload?: Record<string, JsonValue>;
}) =>
	Effect.gen(function* () {
		const parent = yield* workflow.run(
			{ ...input, command: importCommand(input.runId) },
			emptyJournal,
			execution,
		);
		const child = parent.requests[0];
		assert(child?.kind === "child");
		expect(child.args.workflowSlug).toBe("media-import-segment");
		const segment = yield* segmentWorkflow.run(
			yield* Schema.decodeUnknownEffect(MediaImportSegmentInput)(child.args.input),
			emptyJournal,
			execution,
		);
		return segment.requests[0];
	});

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
		"spotify",
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

it.live("passes Netflix profile selection from source payload to its parser activity", () =>
	Effect.gen(function* () {
		const request = yield* parserRequest({
			source: "netflix",
			runId: "run-netflix",
			sourcePayload: { profileName: "Kids" },
		});
		expect(request).toMatchObject({
			kind: "activity",
			args: { scriptSlug: "import.netflix", input: { start: 0, limit: 25, profileName: "Kids" } },
		});
	}),
);

it.live("passes the AniList timezone from source payload to its parser activity", () =>
	Effect.gen(function* () {
		const request = yield* parserRequest({
			source: "anilist",
			runId: "run-anilist",
			sourcePayload: { timezone: " Asia/Kolkata " },
		});
		expect(request).toMatchObject({
			kind: "activity",
			args: {
				scriptSlug: "import.anilist",
				input: { start: 0, limit: 25, timezone: "Asia/Kolkata" },
			},
		});
	}),
);

it.live("fails the AniList workflow when the timezone is missing", () =>
	Effect.gen(function* () {
		const envelope = yield* workflow.run(
			{
				source: "anilist",
				sourcePayload: {},
				runId: "run-anilist-missing",
				command: importCommand("run-anilist-missing"),
			},
			{ replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		);
		assert(envelope.state === "failed");
		expect(envelope.error).toContain("Import job is missing AniList timezone");
		expect(envelope.requests).toEqual([]);
	}),
);

it.live.each([
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
] as const)("passes Trakt $0 fields to its parser activity", ([_, sourcePayload, input]) =>
	Effect.gen(function* () {
		const request = yield* parserRequest({
			sourcePayload,
			source: "trakt",
			runId: `run-trakt-${_}`,
		});
		expect(request).toMatchObject({
			kind: "activity",
			args: { scriptSlug: "import.trakt", input: { start: 0, limit: 25, ...input } },
		});
	}),
);

it.live("passes credentialed source payload fields to its parser activity", () =>
	Effect.gen(function* () {
		const request = yield* parserRequest({
			source: "plex",
			runId: "run-plex",
			sourcePayload: {
				apiKey: "token",
				apiUrl: "https://plex.example",
				allowInsecureConnections: true,
			},
		});
		expect(request).toMatchObject({
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
		});
	}),
);

it.live("selects optional MyAnimeList artifacts from source payload field markers", () =>
	Effect.gen(function* () {
		const request = yield* parserRequest({
			runId: "run-mal",
			source: "myanimelist",
			sourcePayload: { mangaUploadToken: "mangaUploadToken" },
		});
		expect(request).toMatchObject({
			kind: "activity",
			args: {
				scriptSlug: "import.myanimelist",
				input: { start: 0, limit: 25, hasMangaFile: true, hasAnimeFile: false },
			},
		});
	}),
);

it.live("marks adapter-only integration failures as failed kernel runs", () =>
	Effect.gen(function* () {
		const journal: JsonValue[] = [];
		const input = {
			source: "kodi",
			runId: "run-kodi",
			command: importCommand("run-kodi", "integration-1"),
			sourcePayload: {
				integrationId: "integration-1",
				integrationScriptSlug: "integration.kodi",
				integrationContext: { rawBody: "{}", contentType: "application/json" },
			},
		};
		const replay = () =>
			workflow.run(
				input,
				{ replayJournal: () => Effect.succeed(journal) } satisfies WorkflowReplayHost,
				{ metadata: {}, sandboxScriptId: "media-import" },
			);

		let envelope = yield* replay();
		expect(envelope).toMatchObject({
			state: "pending",
			requests: [{ kind: "activity", args: { scriptSlug: "integration.kodi" } }],
		});
		journal.push({
			entityGroups: [],
			failures: [{ itemIndex: 0, message: "Invalid payload", stage: "input_transformation" }],
		});

		envelope = yield* replay();
		const chunkRequest = envelope.requests[journal.length];
		assert(chunkRequest?.kind === "activity");
		expect(chunkRequest.args.scriptSlug).toBe("import.write-chunks");
		journal.push({
			totalItems: 1,
			failureCount: 1,
			writeItemCount: 0,
			chunkHandles: ["harvest-handle-0"],
		});

		envelope = yield* replay();
		const kernelRequest = envelope.requests[journal.length];
		assert(kernelRequest?.kind === "child");
		expect(kernelRequest.args).toMatchObject({
			input: { failRun: true },
			workflowSlug: "kernel:process-import-chunks",
		});
		expect(
			envelope.requests.some(
				(request) =>
					request.kind === "child" && request.args.workflowSlug === "media-import-segment",
			),
		).toBe(false);
	}),
);

it.live(
	"dispatches integration runs to the adapter even when the source names a credentialed parser",
	() =>
		Effect.gen(function* () {
			const envelope = yield* workflow.run(
				{
					source: "audiobookshelf",
					runId: "run-audiobookshelf",
					command: importCommand("run-audiobookshelf", "integration-2"),
					sourcePayload: {
						integrationId: "integration-2",
						integrationScriptSlug: "integration.audiobookshelf",
						integrationContext: { rawBody: "{}", contentType: "application/json" },
					},
				},
				{ replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost,
				{ metadata: {}, sandboxScriptId: "media-import" },
			);

			expect(envelope).toMatchObject({
				state: "pending",
				requests: [{ kind: "activity", args: { scriptSlug: "integration.audiobookshelf" } }],
			});
		}),
);

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

const watcharrSegmentInput = Schema.decodeSync(MediaImportSegmentInput)({
	start: 0,
	runId: "run-1",
	source: "watcharr",
	command: importCommand("run-1"),
	parserInput: { start: 0, limit: 25 },
});

const driveWatcharrImport = (input: {
	episodeResults: JsonValue;
	entityGroups: ReadonlyArray<JsonValue>;
	populationResults: ReadonlyArray<JsonValue>;
}) => {
	const requests: Array<WorkflowReplayEnvelope["requests"][number]> = [];
	const parentRequests: Array<WorkflowReplayEnvelope["requests"][number]> = [];
	const resolveSegmentRequest = (
		request: WorkflowReplayEnvelope["requests"][number],
	): JsonValue => {
		if (request.kind === "activity" && request.args.scriptSlug === "import.watcharr") {
			return { failures: [], totalItems: 1, entityGroups: [...input.entityGroups] };
		}
		if (request.kind === "child" && request.args.workflowSlug === "media-import-population") {
			return { results: [...input.populationResults] };
		}
		if (request.kind === "activity" && request.args.scriptSlug === "import.resolve-episodes") {
			return input.episodeResults;
		}
		assert(request.kind === "activity" && request.args.scriptSlug === "import.write-chunks");
		return {
			totalItems: 1,
			failureCount: 1,
			writeItemCount: 1,
			chunkHandles: ["harvest-handle-0"],
		};
	};
	const replaySegment = Effect.fnUntraced(function* () {
		const journal: JsonValue[] = [];
		for (;;) {
			const envelope = yield* segmentWorkflow.run(
				watcharrSegmentInput,
				{ replayJournal: () => Effect.succeed(journal) } satisfies WorkflowReplayHost,
				execution,
			);
			requests.splice(0, requests.length, ...envelope.requests);
			if (envelope.state !== "pending") {
				return envelope;
			}
			const request = envelope.requests[journal.length];
			assert(request);
			journal.push(resolveSegmentRequest(request));
		}
	});
	const replay = Effect.fnUntraced(function* () {
		const journal: JsonValue[] = [];
		for (;;) {
			const envelope = yield* workflow.run(
				{ runId: "run-1", source: "watcharr", command: importCommand("run-1") },
				{ replayJournal: () => Effect.succeed(journal) } satisfies WorkflowReplayHost,
				execution,
			);
			parentRequests.splice(0, parentRequests.length, ...envelope.requests);
			if (envelope.state !== "pending") {
				return envelope;
			}
			const request = envelope.requests[journal.length];
			assert(request?.kind === "child");
			if (request.args.workflowSlug === "media-import-segment") {
				const segment = yield* replaySegment();
				assert(segment.state === "completed");
				journal.push(segment.output);
			} else {
				journal.push({ failedItems: 1, importedItems: 1, processedItems: 2 });
			}
		}
	});

	return { replay, requests, replaySegment, parentRequests };
};

it.live("fails the workflow rather than dying when a source payload is incomplete", () =>
	Effect.gen(function* () {
		const envelope = yield* workflow.run(
			{
				source: "igdb",
				runId: "run-igdb",
				command: importCommand("run-igdb"),
				sourcePayload: { collection: "  " },
			},
			{ replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		);
		assert(envelope.state === "failed");
		expect(envelope.error).toContain("Import job is missing IGDB collection");
		expect(envelope.requests).toEqual([]);
	}),
);

it.live.each([
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
] as const)("fails the Trakt workflow on $0", ([_, sourcePayload, error]) =>
	Effect.gen(function* () {
		const envelope = yield* workflow.run(
			{
				sourcePayload,
				source: "trakt",
				runId: "run-trakt-invalid",
				command: importCommand("run-trakt-invalid"),
			},
			{ replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		);
		assert(envelope.state === "failed");
		expect(envelope.error).toContain(error);
		expect(envelope.requests).toEqual([]);
	}),
);

const singleShowGroup = (events: ReadonlyArray<JsonValue>) => [
	{ itemIndex: 0, events: [...events], entityRef: showEntityRef, collectionMemberships: [] },
];

const completedShowPopulation = [{ index: 0, entityId: "show-1", status: "completed" }];

it.live("passes integration attribution and resolved episode identity to event production", () =>
	Effect.gen(function* () {
		const envelope = yield* workflow.run(
			{
				source: "kodi",
				runId: "run-1",
				command: importCommand("run-1", "integration-1"),
				sourcePayload: {
					integrationId: "integration-1",
					integrationScriptSlug: "integration.kodi",
				},
			},
			{
				replayJournal: () =>
					Effect.succeed<ReadonlyArray<JsonValue>>([
						{
							failures: [],
							entityGroups: singleShowGroup([
								progressEvent("2026-01-01T00:00:00.000Z", showEpisode(1, 1)),
							]),
						},
						{ results: completedShowPopulation },
						{ results: [{ index: 0, entityId: "episode-1" }] },
					]),
			} satisfies WorkflowReplayHost,
			{ metadata: {}, sandboxScriptId: "media-import" },
		);
		expect(envelope).toMatchObject({ state: "pending" });
		expect(envelope.requests[3]).toMatchObject({
			kind: "activity",
			args: {
				scriptSlug: "import.write-chunks",
				input: {
					populationResults: completedShowPopulation,
					integration: { importRunId: "run-1", integrationId: "integration-1" },
					entityGroups: [
						{
							events: [
								{
									subjectEntityId: "episode-1",
									properties: { progressPercent: 100 },
									subjectEntitySchemaSlug: "show-episode",
								},
							],
						},
					],
				},
			},
		});
	}),
);

it.live(
	"deterministically composes Watcharr parsing, population, episode resolution, and kernel writes",
	() =>
		Effect.gen(function* () {
			const { replay, requests, parentRequests } = driveWatcharrImport({
				populationResults: completedShowPopulation,
				episodeResults: { results: [{ index: 0, entityId: null }] },
				entityGroups: singleShowGroup([
					progressEvent("2026-01-01T00:00:00.000Z", showEpisode(1, 99)),
				]),
			});

			const envelope = yield* replay();
			expect(envelope).toMatchObject({
				state: "completed",
				output: { failedItems: 1, importedItems: 1, processedItems: 2 },
			});
			expect(parentRequests.map(({ kind }) => kind)).toEqual(["child", "child"]);
			expect(requests.map(({ kind }) => kind)).toEqual([
				"activity",
				"child",
				"activity",
				"activity",
			]);
			expect(requests[1]).toMatchObject({
				args: {
					workflowSlug: "media-import-population",
					input: {
						items: [
							expect.objectContaining({
								index: 0,
								providerSlug: "show.tmdb",
								command: {
									...importCommand("run-1"),
									itemIdentity: encodeJson([importCommand("run-1").itemIdentity, "population", 0]),
								},
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
							{
								index: 0,
								kind: "show",
								seasonNumber: 1,
								episodeNumber: 99,
								showEntityId: "show-1",
							},
						],
					},
				},
			});
		}),
);

it.live(
	"subjects resolved episodes, omits unresolved ones as failures, and keeps sibling events",
	() =>
		Effect.gen(function* () {
			const { requests, replaySegment } = driveWatcharrImport({
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

			yield* replaySegment();
			expect(requests[2]).toMatchObject({
				args: {
					input: {
						refs: [
							{ index: 0, kind: "show", seasonNumber: 1, episodeNumber: 1, showEntityId: "show-1" },
							{
								index: 1,
								kind: "show",
								seasonNumber: 1,
								episodeNumber: 99,
								showEntityId: "show-1",
							},
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
			expect(writeRequest.args.input).not.toMatchObject({
				entityGroups: expect.arrayContaining([
					{
						events: expect.arrayContaining([
							expect.objectContaining({ unresolvedEpisode: expect.anything() }),
						]),
					},
				]),
			});
			expect(writeRequest.args.input).not.toMatchObject({
				entityGroups: expect.arrayContaining([
					{
						events: expect.arrayContaining([
							expect.objectContaining({ subjectEntityId: "show-1" }),
						]),
					},
				]),
			});
		}),
);

it.live("reports the podcast episode that could not be resolved", () =>
	Effect.gen(function* () {
		const { requests, replaySegment } = driveWatcharrImport({
			episodeResults: { results: [{ index: 0, entityId: null }] },
			populationResults: [{ index: 0, status: "completed", entityId: "podcast-1" }],
			entityGroups: [
				{
					itemIndex: 0,
					collectionMemberships: [],
					events: [
						progressEvent("2026-01-01T00:00:00.000Z", { type: "podcast", episodeNumber: 7 }),
					],
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

		yield* replaySegment();
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
	}),
);

it.live.each([
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
])("fails the workflow on $label episode result indices", ({ error, results }) =>
	Effect.gen(function* () {
		const { requests, replaySegment } = driveWatcharrImport({
			episodeResults: { results },
			populationResults: completedShowPopulation,
			entityGroups: singleShowGroup([
				progressEvent("2026-01-01T00:00:00.000Z", showEpisode(1, 1)),
				progressEvent("2026-01-02T00:00:00.000Z", showEpisode(1, 2)),
			]),
		});

		const envelope = yield* replaySegment();
		assert(envelope.state === "failed");
		expect(envelope.error).toContain(error);
		expect(envelope.requests.map(({ kind }) => kind)).toEqual(["activity", "child", "activity"]);
		expect(requests).toHaveLength(3);
	}),
);
