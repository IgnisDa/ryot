import { afterEach, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { compareMediaRecords, normalizeMediaRecords, serializeMediaRecords } from "./collection";
import type { MediaSourceRecord } from "./collection-schemas";
import { mediaFilesystem, mediaStageInput, resetMediaFilesystem } from "./ingestion.test-support";
import { normalizeTraktRecord } from "./trakt";
import trakt from "./trakt-export.sandbox";
import { classifyTraktExportName } from "./trakt-files";

afterEach(resetMediaFilesystem);
const encoder = new TextEncoder();
const movie = { year: null, title: "Arrival", ids: { trakt: 1, tmdb: 329865, imdb: "tt2543164" } };
const show = { title: "Dark", ids: { trakt: 2, tmdb: 70523 } };
const occurredAt = "2024-02-01T00:00:00Z";

const captureFiles = Effect.fn(function* (files: ReadonlyArray<readonly [string, unknown[]]>) {
	const fs = mediaFilesystem({});
	const raw: MediaSourceRecord[] = [];
	let itemIndex = 0;
	for (const [name, rows] of files) {
		const contents = encoder.encode(
			yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.Unknown)))(rows),
		);
		const bytes = new Uint8Array(30 + contents.length);
		new DataView(bytes.buffer).setUint32(0, 0x04034b50, true);
		bytes.set(contents, 30);
		fs.files.set("exportUploadToken", bytes);
		const result = yield* trakt.run(
			mediaStageInput({
				itemIndex,
				entry: {
					name,
					compression: 0,
					localOffset: 0,
					size: contents.length,
					compressedSize: contents.length,
				},
			}),
		);
		expect(result.done).toBe(true);
		itemIndex = result.itemIndex;
		raw.push(...(yield* fs.records()));
	}
	fs.files.set("records", encoder.encode(serializeMediaRecords(raw.sort(compareMediaRecords))));
	return fs;
});

it.live(
	"normalizes captured Trakt files across the metadata window and replays identical atoms",
	() =>
		Effect.gen(function* () {
			const fs = yield* captureFiles([
				["watched-history.json", [{ show, watched_at: occurredAt }]],
				[
					"ratings-seasons.json",
					[{ show, rating: 9, rated_at: occurredAt, season: { ids: {}, number: 1 } }],
				],
				[
					"ratings-episodes-10.json",
					[
						{
							show,
							rating: 8,
							rated_at: occurredAt,
							episode: { season: 2, number: 4, ids: { imdb: null, tmdb: null } },
						},
					],
				],
				[
					"comments-episodes.json",
					[
						{
							show,
							episode: { ids: {}, season: 2, number: 4 },
							comment: { spoiler: true, comment: " Great ", created_at: occurredAt },
						},
					],
				],
				[
					"watched-history-2.json",
					[{ show, watched_at: occurredAt, episode: { ids: {}, season: 2, number: 4 } }],
				],
				["lists-list-42-top-movies.json", [{ movie }]],
				["lists-list-99-unknown.json", [{ movie }]],
				["lists-watchlist.json", [{ movie, listed_at: occurredAt }]],
				["lists-favorites.json", [{ movie }]],
				["collection-movies.json", [{ movie }]],
				[
					"lists-lists.json",
					Array.from({ length: 21 }, (_, index) => ({
						description: "Preserved carry",
						ids: { trakt: index === 20 ? 42 : index },
						name: index === 20 ? "Top Movies" : `List ${index}`,
					})),
				],
			]);
			const input = mediaStageInput({
				action: "normalize",
				ingestionArtifacts: { runId: "run", captures: { records: "records" } },
			});
			const first = yield* trakt.run(input);
			expect(first.itemIndex).toBe(20);
			expect(first.done).toBe(false);
			expect(yield* fs.records()).toEqual([]);
			const carry = fs.scratch.get("metadata.json")?.slice();
			expect(carry).toBeDefined();
			const replay = yield* trakt.run(input);
			expect(replay.offset).toBe(first.offset);
			expect(fs.scratch.get("metadata.json")).toEqual(carry);
			fs.files.set("carry", carry ?? new Uint8Array());
			const next = mediaStageInput({
				action: "normalize",
				offset: first.offset,
				itemIndex: first.itemIndex,
				ingestionArtifacts: { runId: "run", captures: { carry: "carry", records: "records" } },
			});
			const second = yield* trakt.run(next);
			const records = yield* fs.records();
			expect(second.done).toBe(true);
			expect(second.itemIndex).toBe(31);
			expect(records).toHaveLength(10);
			expect(
				records.map((record) => ("operationId" in record ? record.operationId : undefined)),
			).toEqual([
				'["media-membership",8,"Favorites"]',
				'["media-membership",9,"Owned"]',
				'["media-membership",5,"Top Movies"]',
				'["media-membership",6,"Trakt List 99"]',
				'["media-membership",7,"Watchlist"]',
				'["media-event",1,0]',
				'["media-event",2,0]',
				'["media-event",3,0]',
				'["media-event",4,0]',
				'["media-source",0,0,0]',
			]);
			expect(records.at(-1)?.failure).toEqual({
				itemIndex: 0,
				sourceLabel: "Dark",
				sourceIdentifier: "2",
				operationId: '["media-source",0,0,0]',
				message: "Show history item has no episode coordinates",
			});
			const events = records.flatMap((record) => record.group?.events ?? []);
			expect(
				events.map((event) => [event.eventSchemaSlug, event.properties, event.unresolvedEpisode]),
			).toEqual([
				["review", { rating: 90 }, { seasonNumber: 1, type: "show-season" }],
				["review", { rating: 80 }, { type: "show", seasonNumber: 2, episodeNumber: 4 }],
				[
					"review",
					{ text: "Great", isSpoiler: true },
					{ type: "show", seasonNumber: 2, episodeNumber: 4 },
				],
				["progress", { progressPercent: 100 }, { type: "show", seasonNumber: 2, episodeNumber: 4 }],
			]);
			expect(events.map((event) => event.attribution)).toEqual(
				[1, 2, 3, 4].map((index) => ({
					sourceLabel: "Dark",
					sourceIdentifier: "70523",
					recordId: `["media-source",${index}]`,
				})),
			);
			yield* trakt.run(next);
			expect(yield* fs.records()).toEqual(records);
			expect(fs.reads.every((read) => read.length <= 256 * 1024)).toBe(true);
		}),
);

it("preserves decoded history, provider priority, missing identifiers, and failure precedence", () => {
	expect(
		normalizeTraktRecord({ movie, watched_at: occurredAt }, { type: "history" }).entityGroups[0],
	).toEqual({
		itemIndex: 0,
		collectionMemberships: [],
		events: [{ occurredAt, properties: {}, eventSchemaSlug: "complete" }],
		entityRef: {
			kind: "resolved",
			externalId: "329865",
			sourceLabel: "Arrival",
			entitySchemaSlug: "movie",
			providerSlug: "movie.tmdb",
		},
	});
	expect(
		normalizeTraktRecord(
			{ movie: { ids: { imdb: " tt123 " } } },
			{ name: "Owned", type: "collection" },
		).entityGroups[0]?.entityRef,
	).toEqual({
		kind: "unresolved",
		identifierType: "imdb",
		identifierValue: "tt123",
		entitySchemaSlug: "movie",
		sourceLabel: "Movie unknown",
	});
	expect(
		normalizeMediaRecords(
			normalizeTraktRecord(
				{ movie: { title: "Missing", ids: { trakt: 7 } } },
				{ name: "Owned", type: "collection" },
			),
			42,
			"trakt",
		)[0]?.failure,
	).toEqual({
		itemIndex: 42,
		sourceIdentifier: "7",
		sourceLabel: "Missing",
		operationId: '["media-source",42,0,0]',
		message: "Movie does not have a TMDB or IMDb id",
	});
	expect(normalizeTraktRecord({}, { type: "history" }).failures[0]?.message).toBe(
		"History item does not have a watched date",
	);
	expect(normalizeTraktRecord({}, { type: "rating" }).failures[0]?.message).toBe(
		"Trakt rating item does not contain review data",
	);
	expect(normalizeTraktRecord({}, { name: "Owned", type: "collection" }).failures[0]?.message).toBe(
		"Item is neither a movie nor a show",
	);
	expect(() =>
		normalizeTraktRecord(
			{ movie: { ids: { tmdb: "bad" } } },
			{ name: "Owned", type: "collection" },
		),
	).toThrow();
});

it("keeps filename classification at the ZIP boundary and ignores aggregate watched files", () => {
	expect(classifyTraktExportName("watched-movies.json")).toBeUndefined();
	expect(classifyTraktExportName("profile.json")).toBeUndefined();
	expect(classifyTraktExportName("ratings-movies-2.json")?.page).toBe(2);
	expect(classifyTraktExportName("ratings-movies-10.json")?.page).toBe(10);
});

it.live("rejects malformed captured list metadata before committing a normalization window", () =>
	Effect.gen(function* () {
		yield* captureFiles([["lists-lists.json", [{ name: "Broken", ids: { trakt: "bad" } }]]]);
		const result = yield* trakt
			.run(
				mediaStageInput({
					action: "normalize",
					ingestionArtifacts: { runId: "run", captures: { records: "records" } },
				}),
			)
			.pipe(Effect.exit);
		expect(result._tag).toBe("Failure");
	}),
);
