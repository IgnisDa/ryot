import { afterEach, assert, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import {
	execution,
	hostFailure,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../../tests/backend/automations/automation-test-utils";
import { MediaNormalizedSourceRecord } from "../../imports/collection-schemas";
import { mediaFilesystem, resetMediaFilesystem } from "../../imports/ingestion.test-support";
import plex, { manifest } from "./plex.sandbox";

afterEach(resetMediaFilesystem);

const metadata = (items: Array<Record<string, JsonValue>>) => ({
	MediaContainer: { Metadata: items },
});

const show = (id: string) => ({
	ratingKey: id,
	title: `Show ${id}`,
	key: `/shows/${id}`,
	lastViewedAt: 1767225600,
	Guid: [{ id: `tmdb://${id}` }],
});

const episode = (index: number): Record<string, JsonValue> => ({
	parentIndex: 1,
	index: index + 1,
	lastViewedAt: 1767225600,
	title: `Episode ${index}`,
	ratingKey: `episode-${index}`,
});

const setup = (routes: Record<string, JsonValue>, syncOwnership = true) => {
	const fs = mediaFilesystem({});
	const requests: string[] = [];
	const host = defineSandboxTestHost(manifest, {
		getCurrentIntegration: () =>
			hostSuccess(
				integrationRecord({
					syncOwnership,
					provider: "plex_yank",
					providerSpecifics: { token: "token", baseUrl: "https://plex.test" },
				}),
			),
		httpCall: (_method, url) => {
			const path = url.replace("https://plex.test", "");
			requests.push(path);
			const response = routes[path];
			return response === undefined ? hostFailure("request failed") : httpSuccess(response);
		},
	});
	const run = Effect.fn(function* (carry?: Uint8Array) {
		if (carry) {
			fs.files.set("carry", carry.slice());
		}
		const output = yield* runSandboxTestScript(
			plex,
			carry ? { ingestionArtifacts: { runId: "run", captures: { carry: "durable-carry" } } } : {},
			host,
			execution,
		);
		const records = yield* Schema.decodeUnknownEffect(Schema.Array(MediaNormalizedSourceRecord))(
			yield* fs.records(),
		);
		if (!output.carryFile) {
			return { records, carry: undefined };
		}
		const next = fs.scratch.get(output.carryFile);
		assert(next);
		return { records, carry: next.slice() };
	});
	return { run, requests };
};

for (const count of [127, 128, 129, 300]) {
	for (const syncOwnership of [false, true]) {
		it.live(
			`retains exact ${count}-leaf checkpoints, replay, and following show/movie indexes with ownership ${syncOwnership}`,
			() =>
				Effect.gen(function* () {
					const { run, requests } = setup(
						{
							"/library/metadata/43/allLeaves": metadata([episode(0)]),
							"/library/sections/shows/all?includeGuids=1": metadata([show("42"), show("43")]),
							"/library/metadata/42/allLeaves": metadata(
								Array.from({ length: count }, (_, index) => episode(index)),
							),
							"/library/sections/movies/all?includeGuids=1": metadata([
								{ title: "Movie", lastViewedAt: 1767225600, Guid: [{ id: "tmdb://44" }] },
							]),
							"/library/sections": {
								MediaContainer: {
									Directory: [
										{ key: "shows", type: "show" },
										{ key: "movies", type: "movie" },
									],
								},
							},
						},
						syncOwnership,
					);
					let carry: undefined | Uint8Array;
					for (let offset = 0; offset < count; offset += 128) {
						const window = yield* run(carry);
						const events = window.records.filter((record) => record.group?.events.length);
						expect(events).toMatchObject(
							Array.from({ length: Math.min(128, count - offset) }, (_, index) => ({
								itemIndex: 0,
								eventIndex: offset + index,
								operationId: JSON.stringify(["integration-plex-event", 0, offset + index]),
								group: {
									itemIndex: 0,
									entityRef: { externalId: "42" },
									events: [
										{
											sourceItemIndex: 0,
											occurredAt: "2026-01-01T00:00:00.000Z",
											operationId: JSON.stringify(["integration-plex-event", 0, offset + index]),
											unresolvedEpisode: {
												type: "show",
												seasonNumber: 1,
												episodeNumber: offset + index + 1,
											},
											attribution: {
												sourceLabel: `Episode ${offset + index}`,
												sourceIdentifier: `episode-${offset + index}`,
												recordId: JSON.stringify(["plex-leaf", `episode-${offset + index}`]),
											},
										},
									],
								},
							})),
						);
						const owned = window.records.filter((record) => record.group?.ownershipProvider);
						const finished = offset + 128 >= count;
						expect(owned).toHaveLength(syncOwnership && finished ? 1 : 0);
						if (owned.length) {
							expect(owned).toMatchObject([
								{
									itemIndex: 0,
									eventIndex: 0,
									operationId: '["media-association",0]',
									group: { events: [], ownershipProvider: "plex_yank" },
								},
							]);
						}
						assert(window.carry);
						expect(
							yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
								new TextDecoder().decode(window.carry),
							),
						).toMatchObject({
							itemIndex: 1,
							directoryIndex: 0,
							continuation: finished
								? { offset: 1, phase: "listing" }
								: {
										itemIndex: 0,
										phase: "episodes",
										leafOffset: offset + 128,
										entityRef: { externalId: "42" },
										resume: { offset: 1, phase: "listing" },
									},
						});
						if (carry) {
							const fetched = requests.length;
							expect(yield* run(carry)).toEqual(window);
							expect(requests).toHaveLength(fetched);
						}
						carry = window.carry;
					}
					const nextShow = yield* run(carry);
					expect(nextShow.records.filter((record) => record.group?.events.length)).toMatchObject([
						{
							itemIndex: 1,
							eventIndex: 0,
							group: { entityRef: { externalId: "43" } },
							operationId: '["integration-plex-event",1,0]',
						},
					]);
					expect(nextShow.records.filter((record) => record.group?.ownershipProvider)).toHaveLength(
						syncOwnership ? 1 : 0,
					);
					assert(nextShow.carry);
					expect(
						yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
							new TextDecoder().decode(nextShow.carry),
						),
					).toMatchObject({
						itemIndex: 2,
						directoryIndex: 1,
						continuation: { phase: "directory" },
					});
					const movie = yield* run(nextShow.carry);
					expect(movie.carry).toBeUndefined();
					expect(movie.records.filter((record) => record.group?.events.length)).toMatchObject([
						{
							itemIndex: 2,
							eventIndex: 0,
							operationId: '["media-event",2,0]',
							group: {
								entityRef: { externalId: "44" },
								events: [
									{
										eventSchemaSlug: "complete",
										attribution: { sourceIdentifier: "2", recordId: '["plex-item",2]' },
									},
								],
							},
						},
					]);
					expect(movie.records.filter((record) => record.group?.ownershipProvider)).toHaveLength(
						syncOwnership ? 1 : 0,
					);
					expect(requests).toEqual([
						"/library/sections",
						"/library/sections/shows/all?includeGuids=1",
						"/library/metadata/42/allLeaves",
						"/library/metadata/43/allLeaves",
						"/library/sections/movies/all?includeGuids=1",
					]);
				}),
		);
	}
}

it.live(
	"skips invalid and unwatched boundary leaves without shifting source IDs or ownership",
	() =>
		Effect.gen(function* () {
			const leaves = Array.from({ length: 260 }, (_, index) => episode(index));
			leaves[126] = { ...episode(126), lastViewedAt: "invalid" };
			leaves[127] = { index: 128, parentIndex: 1, title: "Unwatched" };
			leaves[128] = { lastViewedAt: 1767225600, title: "Missing coordinates" };
			leaves[129] = { index: 130, parentIndex: 1, title: "Fallback", lastViewedAt: 1767225600 };
			leaves[255] = { ...episode(255), lastViewedAt: "invalid" };
			leaves[256] = { index: 257, parentIndex: 1, title: "Unwatched" };
			const { run, requests } = setup({
				"/library/metadata/42/allLeaves": metadata(leaves),
				"/library/sections/shows/all?includeGuids=1": metadata([show("42")]),
				"/library/sections": { MediaContainer: { Directory: [{ key: "shows", type: "show" }] } },
			});
			const first = yield* run();
			expect(
				first.records.map(({ itemIndex, eventIndex, operationId }) => ({
					itemIndex,
					eventIndex,
					operationId,
				})),
			).toEqual(
				Array.from({ length: 126 }, (_, index) => ({
					itemIndex: 0,
					eventIndex: index,
					operationId: JSON.stringify(["integration-plex-event", 0, index]),
				})),
			);
			assert(first.carry);
			const second = yield* run(first.carry);
			expect(
				second.records.map(({ eventIndex, operationId }) => ({ eventIndex, operationId })),
			).toEqual(
				Array.from({ length: 126 }, (_, index) => ({
					eventIndex: 128 + index,
					operationId: JSON.stringify(["integration-plex-event", 0, 129 + index]),
				})),
			);
			expect(second.records[0]?.group?.events[0]?.attribution).toEqual({
				sourceLabel: "Fallback",
				sourceIdentifier: "/shows/42",
				recordId: '["plex-leaf",129]',
			});
			assert(second.carry);
			const final = yield* run(second.carry);
			expect(final.carry).toBeUndefined();
			expect(
				final.records
					.filter((record) => record.group?.events.length)
					.map(({ eventIndex, operationId }) => ({ eventIndex, operationId })),
			).toEqual([
				{ eventIndex: 256, operationId: '["integration-plex-event",0,257]' },
				{ eventIndex: 257, operationId: '["integration-plex-event",0,258]' },
				{ eventIndex: 258, operationId: '["integration-plex-event",0,259]' },
			]);
			expect(final.records.filter((record) => record.group?.ownershipProvider)).toMatchObject([
				{
					itemIndex: 0,
					operationId: '["media-association",0]',
					group: { ownershipProvider: "plex_yank" },
				},
			]);
			expect(yield* run(second.carry)).toEqual(final);
			expect(requests).toHaveLength(3);
		}),
);

it.live("finishes an all-skipped episode window once before the next listing item", () =>
	Effect.gen(function* () {
		const { run, requests } = setup({
			"/library/metadata/43/allLeaves": metadata([]),
			"/library/sections/shows/all?includeGuids=1": metadata([show("42"), show("43")]),
			"/library/sections": { MediaContainer: { Directory: [{ key: "shows", type: "show" }] } },
			"/library/metadata/42/allLeaves": metadata([
				...Array.from({ length: 128 }, (_, index) => episode(index)),
				{ index: 129, parentIndex: 1, title: "Unwatched" },
			]),
		});
		const first = yield* run();
		assert(first.carry);
		const finalLeaves = yield* run(first.carry);
		expect(finalLeaves.records).toMatchObject([
			{
				itemIndex: 0,
				eventIndex: 0,
				operationId: '["media-association",0]',
				group: { events: [], ownershipProvider: "plex_yank", entityRef: { externalId: "42" } },
			},
		]);
		expect(yield* run(first.carry)).toEqual(finalLeaves);
		assert(finalLeaves.carry);
		const next = yield* run(finalLeaves.carry);
		expect(next.carry).toBeUndefined();
		expect(next.records).toMatchObject([
			{
				itemIndex: 1,
				operationId: '["media-association",1]',
				group: { events: [], ownershipProvider: "plex_yank", entityRef: { externalId: "43" } },
			},
		]);
		expect(requests).toEqual([
			"/library/sections",
			"/library/sections/shows/all?includeGuids=1",
			"/library/metadata/42/allLeaves",
			"/library/metadata/43/allLeaves",
		]);
	}),
);

it.live(
	"advances skipped and failed libraries without reusing indexes and owns failed or unplayed shows",
	() =>
		Effect.gen(function* () {
			const { run, requests } = setup({
				"/library/sections/empty/all?includeGuids=1": {},
				"/library/metadata/45/allLeaves": metadata([episode(0)]),
				"/library/sections": {
					MediaContainer: {
						Directory: [
							{ key: "music", type: "artist" },
							{ key: "empty", type: "movie" },
							{ key: "failed", type: "movie" },
							{ key: "shows", type: "show" },
						],
					},
				},
				"/library/sections/shows/all?includeGuids=1": metadata([
					show("42"),
					{ title: "Missing key", lastViewedAt: 1767225600, Guid: [{ id: "tmdb://43" }] },
					{ title: "Unwatched", Guid: [{ id: "tmdb://44" }] },
					{ title: "Missing ID", lastViewedAt: 1767225600 },
					show("45"),
				]),
			});
			const skipped = yield* run();
			expect(skipped.records).toEqual([]);
			assert(skipped.carry);
			const empty = yield* run(skipped.carry);
			expect(empty.records).toEqual([]);
			assert(empty.carry);
			const failedLibrary = yield* run(empty.carry);
			expect(failedLibrary.records).toMatchObject([
				{
					itemIndex: 0,
					operationId: '["media-source",0,0,0]',
					failure: { stage: "source_fetch", message: "Failed to fetch Plex library items" },
				},
			]);
			assert(failedLibrary.carry);
			const failedShow = yield* run(failedLibrary.carry);
			expect(failedShow.records).toMatchObject([
				{
					itemIndex: 1,
					operationId: '["media-association",1]',
					group: { events: [], ownershipProvider: "plex_yank", entityRef: { externalId: "42" } },
				},
				{
					itemIndex: 1,
					operationId: '["media-source",1,0,0]',
					failure: { stage: "source_fetch", message: "Failed to fetch watched episodes from Plex" },
				},
			]);
			assert(failedShow.carry);
			const missingKey = yield* run(failedShow.carry);
			expect(missingKey.records).toMatchObject([
				{
					itemIndex: 2,
					operationId: '["media-association",2]',
					group: { ownershipProvider: "plex_yank" },
				},
				{
					itemIndex: 2,
					operationId: '["media-source",2,0,0]',
					failure: { message: "Plex show has no rating key" },
				},
			]);
			assert(missingKey.carry);
			const unwatched = yield* run(missingKey.carry);
			expect(unwatched.records).toMatchObject([
				{
					itemIndex: 3,
					operationId: '["media-association",3]',
					group: { events: [], ownershipProvider: "plex_yank" },
				},
			]);
			assert(unwatched.carry);
			const missingId = yield* run(unwatched.carry);
			expect(missingId.records).toMatchObject([
				{
					itemIndex: 4,
					operationId: '["media-source",4,0,0]',
					failure: { stage: "input_transformation" },
				},
			]);
			assert(missingId.carry);
			const final = yield* run(missingId.carry);
			expect(final.carry).toBeUndefined();
			expect(final.records.filter((record) => record.group?.events.length)).toMatchObject([
				{ itemIndex: 5, eventIndex: 0, operationId: '["integration-plex-event",5,0]' },
			]);
			expect(requests).toEqual([
				"/library/sections",
				"/library/sections/empty/all?includeGuids=1",
				"/library/sections/failed/all?includeGuids=1",
				"/library/sections/shows/all?includeGuids=1",
				"/library/metadata/42/allLeaves",
				"/library/metadata/45/allLeaves",
			]);
		}),
);
