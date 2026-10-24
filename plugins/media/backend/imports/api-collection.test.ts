import { afterEach, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { stubHttpHost } from "../../tests/backend/imports/source-test-utils";
import { collectTraktApi, MediaApiState, recoverMediaApiTask } from "./api-collection";
import { collectAudiobookshelf } from "./audiobookshelf-collection";
import type { MediaSourceRecord } from "./collection-schemas";
import { mediaFilesystem, mediaStageInput, resetMediaFilesystem } from "./ingestion.test-support";

afterEach(resetMediaFilesystem);
it.live("collects Trakt history and custom list pages once with original record attribution", () =>
	Effect.gen(function* () {
		const calls: string[] = [];
		const host = stubHttpHost(({ url }) => {
			const target = new URL(url);
			const page = Number(target.searchParams.get("page"));
			calls.push(`${target.pathname}:${page}`);
			if (target.pathname.endsWith("/history")) {
				return {
					body: Array.from({ length: page === 1 ? 25 : 1 }, (_, index) => ({
						type: "movie",
						id: index + page * 25,
						movie: { ids: { tmdb: 1 }, title: `Record ${index + page * 25}` },
						watched_at: `2026-01-01T00:${String((page - 1) * 25 + index).padStart(2, "0")}:00Z`,
					})),
				};
			}
			if (target.pathname.endsWith("/lists")) {
				return { body: [{ name: "Custom", ids: { trakt: 7 } }] };
			}
			if (target.pathname.endsWith("/lists/7/items")) {
				return { body: [{ type: "movie", movie: { ids: { tmdb: 1 }, title: "List original" } }] };
			}
			return { body: [] };
		});
		const fs = mediaFilesystem({});
		let input = mediaStageInput({ settings: { mode: "user", username: "alice" } });
		const records: MediaSourceRecord[] = [];
		for (let step = 0; ; step++) {
			const result = yield* collectTraktApi(input, "client", host);
			records.push(...(yield* fs.records()));
			if (result.done) {
				break;
			}
			fs.files.set("carry", fs.scratch.get("state.json") ?? new Uint8Array());
			Object.assign(input, {
				itemIndex: result.itemIndex,
				ingestionArtifacts: { runId: "run", captures: { carry: "carry" } },
			});
			expect(step).toBeLessThan(30);
		}
		expect(new Set(calls).size).toBe(calls.length);
		expect(calls.filter((call) => call.includes("/history:"))).toEqual([
			"/users/alice/history:1",
			"/users/alice/history:2",
		]);
		expect(records.flatMap((record) => record.group?.events ?? [])).toHaveLength(26);
		expect(
			records.find((record) => record.itemIndex === 25)?.group?.events[0]?.attribution,
		).toEqual({ sourceIdentifier: "1", sourceLabel: "Record 50", recordId: '["media-source",25]' });
		expect(records.at(-1)?.group?.collectionMemberships).toEqual([{ collectionName: "Custom" }]);
	}),
);
it.live(
	"collects more than 50 podcast episode details with one request per durable source step",
	() =>
		Effect.gen(function* () {
			const calls: string[] = [];
			const item = {
				id: "podcast",
				media: {
					metadata: { itunesId: "99", title: "Podcast" },
					episodes: Array.from({ length: 53 }, (_, index) => ({
						index: index + 1,
						id: `episode-${index}`,
						title: `Episode ${index}`,
					})),
				},
			};
			const host = stubHttpHost(({ url }) => {
				const target = new URL(url);
				calls.push(target.pathname + target.search);
				if (target.pathname.endsWith("/libraries")) {
					return {
						body: { libraries: [{ id: "podcasts", name: "Podcasts", mediaType: "podcast" }] },
					};
				}
				if (target.pathname.endsWith("/libraries/podcasts/items")) {
					return { body: { results: [item] } };
				}
				return { body: { ...item, userMediaProgress: { isFinished: true } } };
			});
			const fs = mediaFilesystem({});
			let input = mediaStageInput({ settings: { apiKey: "key", apiUrl: "https://abs.example" } });
			const records: MediaSourceRecord[] = [];
			for (let step = 0; ; step++) {
				const before = calls.length;
				const result = yield* collectAudiobookshelf(input, host);
				expect(calls.length - before).toBeLessThanOrEqual(1);
				records.push(...(yield* fs.records()));
				if (result.done) {
					break;
				}
				fs.files.set("carry", fs.scratch.get("state.json") ?? new Uint8Array());
				Object.assign(input, {
					itemIndex: result.itemIndex,
					ingestionArtifacts: { runId: "run", captures: { carry: "carry" } },
				});
				expect(step).toBeLessThan(100);
			}
			expect(calls).toHaveLength(56);
			expect(new Set(calls).size).toBe(56);
			const events = records.flatMap((record) => record.group?.events ?? []);
			expect(events).toHaveLength(53);
			expect(new Set(events.map((event) => event.operationId)).size).toBe(53);
			expect(events.every((event) => event.attribution?.recordId === '["media-source",0]')).toBe(
				true,
			);
		}),
);

it.live(
	"normalizes API task contexts without ZIP semantics and retains skips, attribution, and replay",
	() =>
		Effect.gen(function* () {
			const movie = { title: "Movie", ids: { tmdb: 1, imdb: "tt1" } };
			const show = { title: "Show", ids: { tmdb: 2 } };
			const date = "2025-12-01T00:00:00Z";
			const host = stubHttpHost(({ url }) => {
				const path = new URL(url).pathname;
				if (path.endsWith("/history")) {
					return {
						body: [
							{ show, watched_at: date, episode: { ids: {}, season: 1, number: 2 } },
							{ watched_at: date, movie: { title: "Missing", ids: { trakt: 99 } } },
						],
					};
				}
				if (path.endsWith("/ratings/movies")) {
					return { body: [{ movie, rating: 8, rated_at: date }] };
				}
				if (path.endsWith("/ratings/shows")) {
					return { body: [{ show, rating: 9, rated_at: date }] };
				}
				if (path.endsWith("/watchlist")) {
					return { body: [{ movie, listed_at: date }, { movie }] };
				}
				if (path.endsWith("/lists")) {
					return {
						body: [
							{ name: "Watchlist", ids: { trakt: 1 } },
							{ name: "Custom", ids: { trakt: 7 } },
						],
					};
				}
				if (path.endsWith("/lists/7/items")) {
					return {
						body: [{ person: {}, type: "person" }, { type: "movie" }, { show, type: "show" }],
					};
				}
				if (path.endsWith("/collection/movies")) {
					return { body: [{ movie }] };
				}
				return { body: [{ show }] };
			});
			const fs = mediaFilesystem({});
			let input = mediaStageInput({ settings: { mode: "user", username: "alice" } });
			const records: MediaSourceRecord[] = [];
			for (let step = 0; ; step++) {
				const result = yield* collectTraktApi(input, "client", host);
				const batch = yield* fs.records();
				const state = fs.scratch.get("state.json")?.slice();
				const replay = yield* collectTraktApi(input, "client", host);
				expect(replay.itemIndex).toBe(result.itemIndex);
				expect(yield* fs.records()).toEqual(batch);
				expect(fs.scratch.get("state.json")).toEqual(state);
				records.push(...batch);
				if (result.done) {
					expect(result.itemIndex).toBe(11);
					break;
				}
				fs.files.set("carry", state ?? new Uint8Array());
				Object.assign(input, {
					itemIndex: result.itemIndex,
					ingestionArtifacts: { runId: "run", captures: { carry: "carry" } },
				});
				expect(step).toBeLessThan(10);
			}
			expect(
				records.map((record) => ("operationId" in record ? record.operationId : undefined)),
			).toEqual([
				'["media-event",0,0]',
				'["media-source",1,0,0]',
				'["media-event",2,0]',
				'["media-event",3,0]',
				'["media-event",4,0]',
				'["media-event",5,0]',
				'["media-membership",6,"Owned"]',
				'["media-membership",7,"Owned"]',
				'["media-membership",10,"Custom"]',
			]);
			expect(records[1]?.failure).toEqual({
				itemIndex: 1,
				sourceIdentifier: "99",
				sourceLabel: "Missing",
				operationId: '["media-source",1,0,0]',
				message: "Movie does not have a TMDB or IMDb id",
			});
			expect(records[0]?.group?.events[0]?.unresolvedEpisode).toEqual({
				type: "show",
				seasonNumber: 1,
				episodeNumber: 2,
			});
			expect(records.slice(2, 4).map((record) => record.group?.events[0]?.properties)).toEqual([
				{ rating: 80 },
				{ rating: 90 },
			]);
			expect(records.slice(4, 6).map((record) => record.group)).toEqual(
				[date, input.importedAt].map((occurredAt, index) => ({
					itemIndex: index + 4,
					collectionMemberships: [],
					entityRef: {
						externalId: "1",
						kind: "resolved",
						sourceLabel: "Movie",
						entitySchemaSlug: "movie",
						providerSlug: "movie.tmdb",
					},
					events: [
						{
							occurredAt,
							properties: {},
							eventSchemaSlug: "backlog",
							sourceItemIndex: index + 4,
							operationId: `["media-event",${index + 4},0]`,
							attribution: {
								sourceLabel: "Movie",
								sourceIdentifier: "1",
								recordId: `["media-source",${index + 4}]`,
							},
						},
					],
				})),
			);
		}),
);

it.live("attributes a failed API task to its original source and advances one source record", () =>
	Effect.gen(function* () {
		const fs = mediaFilesystem({
			carry: new TextEncoder().encode(
				yield* Schema.encodeEffect(Schema.fromJsonString(MediaApiState))({
					credentials: {},
					tasks: [
						{
							page: 2,
							context: {},
							kind: "rating",
							name: "ratings-movies.json",
							path: "/users/alice/ratings/movies",
						},
						{
							page: 1,
							context: {},
							kind: "collection",
							name: "collection-movies.json",
							path: "/users/alice/collection/movies",
						},
					],
				}),
			),
		});
		const result = yield* recoverMediaApiTask(
			mediaStageInput({
				itemIndex: 42,
				ingestionArtifacts: { runId: "run", captures: { carry: "carry" } },
			}),
			new Error("upstream"),
			"Trakt",
		);
		expect(result.itemIndex).toBe(43);
		expect(result.done).toBe(false);
		expect((yield* fs.records())[0]?.failure).toEqual({
			itemIndex: 42,
			stage: "source_fetch",
			sourceLabel: "ratings-movies.json",
			operationId: '["media-source",42,0,0]',
			message: "Failed to fetch Trakt source data",
			sourceIdentifier: "/users/alice/ratings/movies",
		});
	}),
);
