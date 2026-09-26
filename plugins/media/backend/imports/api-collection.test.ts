import { afterEach, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { stubHttpHost } from "../../tests/backend/imports/source-test-utils";
import { collectTraktApi } from "./api-collection";
import { collectAudiobookshelf } from "./audiobookshelf-collection";
import type { MediaSourceRecord } from "./collection-schemas";
import { mediaFilesystem, mediaFilesystemKey, mediaStageInput } from "./ingestion.test-support";

afterEach(() => Reflect.deleteProperty(globalThis, mediaFilesystemKey));
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
