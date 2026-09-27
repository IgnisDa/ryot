import { afterEach, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";

import { stubHttpHost } from "../../tests/backend/imports/source-test-utils";
import { collectTraktApi } from "./api-collection";
import audiobookshelf, { manifest as audiobookshelfManifest } from "./audiobookshelf.sandbox";
import { compareMediaRecords, serializeMediaRecords } from "./collection";
import type { MediaSourceInput, MediaSourceOutput, MediaSourceRecord } from "./collection-schemas";
import { mediaFilesystem, mediaFilesystemKey, mediaStageInput } from "./ingestion.test-support";
import jellyfin, { manifest as jellyfinManifest } from "./jellyfin.sandbox";
import { collectMediaTracker } from "./media-tracker-collection";
import plex, { manifest as plexManifest } from "./plex.sandbox";
import type { HttpHost } from "./source-api";

afterEach(() => Reflect.deleteProperty(globalThis, mediaFilesystemKey));
const runSource = Effect.fn(function* <Host extends HttpHost>(
	collect: (
		input: MediaSourceInput,
		host: Host,
	) => Effect.Effect<
		typeof MediaSourceOutput.Type,
		Effect.Error<ReturnType<typeof collectTraktApi>>
	>,
	settings: MediaSourceInput["settings"],
	host: Host,
) {
	const fs = mediaFilesystem({});
	let input = mediaStageInput({ settings });
	const records: MediaSourceRecord[] = [];
	for (let step = 0; ; step++) {
		const result = yield* collect(input, host);
		records.push(...(yield* fs.records()));
		if (result.done) {
			return records;
		}
		if (result.carryFile) {
			fs.files.set("carry", fs.scratch.get(result.carryFile) ?? new Uint8Array());
		}
		Object.assign(input, {
			offset: result.offset,
			header: result.header,
			itemIndex: result.itemIndex,
			...(result.carryFile
				? { ingestionArtifacts: { runId: "run", captures: { carry: "carry" } } }
				: {}),
		});
		if (step > 100) {
			throw new Error("Source did not terminate");
		}
	}
});

it.live("uses the public Trakt list's encoded path and GET pagination metadata", () =>
	Effect.gen(function* () {
		const calls: URL[] = [];
		const host = stubHttpHost(({ url, method }) => {
			expect(method).toBe("GET");
			calls.push(url);
			return {
				headers: { "x-pagination-page-count": "2" },
				body:
					url.searchParams.get("page") === "1"
						? [{ type: "movie", movie: { ids: { tmdb: 603 }, title: "The Matrix" } }]
						: [{ type: "show", show: { title: "Game of Thrones", ids: { imdb: "tt0944947" } } }],
			};
		});
		const records = yield* runSource(
			(input, requestHost) => collectTraktApi(input, "client", requestHost),
			{
				mode: "list",
				collection: "Favorites",
				url: "https://www.trakt.tv/users/alice%20smith/lists/my%20list/?source=test#items",
			},
			host,
		);
		expect(records.map((record) => record.group?.entityRef)).toMatchObject([
			{ externalId: "603", providerSlug: "movie.tmdb" },
			{ kind: "unresolved", identifierValue: "tt0944947" },
		]);
		expect(
			records.every(
				(record) => record.group?.collectionMemberships[0]?.collectionName === "Favorites",
			),
		).toBe(true);
		expect(calls.map((url) => url.pathname)).toEqual([
			"/users/alice%20smith/lists/my%20list/items",
			"/users/alice%20smith/lists/my%20list/items",
		]);
		expect(calls.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
		expect(
			calls.every(
				(url) =>
					url.searchParams.get("limit") === "25" && !url.searchParams.has("source") && !url.hash,
			),
		).toBe(true);
	}),
);
it.live.each([
	"ftp://trakt.tv/users/alice/lists/favorites",
	"https://example.com/users/alice/lists/favorites",
	"https://trakt.tv/users/alice/lists",
	"https://trakt.tv/users//lists/favorites",
	"https://trakt.tv/users/alice/lists/favorites/extra",
])("rejects an invalid Trakt list URL before a source request: %s", (url) =>
	Effect.gen(function* () {
		let calls = 0;
		const host = stubHttpHost(() => {
			calls++;
			return { body: [] };
		});
		const result = yield* collectTraktApi(
			mediaStageInput({ settings: { url, mode: "list", collection: "Favorites" } }),
			"client",
			host,
		).pipe(Effect.exit);
		expect(result._tag).toBe("Failure");
		expect(calls).toBe(0);
	}),
);
it.live("collects Plex movies and bounded show leaves without refetching a section", () =>
	Effect.gen(function* () {
		const calls: string[] = [];
		const httpHost = stubHttpHost(({ path }) => {
			calls.push(path);
			if (path === "/library/sections") {
				return {
					body: {
						MediaContainer: {
							Directory: [
								{ key: "1", type: "movie", title: "Movies" },
								{ key: "2", type: "show", title: "Shows" },
							],
						},
					},
				};
			}
			if (path === "/library/sections/1/all") {
				return {
					body: {
						MediaContainer: {
							Metadata: [
								{
									key: "movie",
									type: "movie",
									title: "Movie",
									lastViewedAt: 1700000000,
									Guid: [{ id: "tmdb://42" }],
								},
							],
						},
					},
				};
			}
			if (path === "/library/sections/2/all") {
				return {
					body: {
						MediaContainer: {
							Metadata: [
								{
									key: "show",
									type: "show",
									title: "Show",
									ratingKey: "9",
									lastViewedAt: 1700000000,
									Guid: [{ id: "tmdb://99" }],
								},
							],
						},
					},
				};
			}
			return {
				body: {
					MediaContainer: {
						Metadata: [1, 2].map((index) => ({
							index,
							parentIndex: 1,
							type: "episode",
							title: "Episode",
							key: `episode-${index}`,
							lastViewedAt: 1700000000 + index,
						})),
					},
				},
			};
		});
		const host = defineSandboxTestHost(plexManifest, { httpCall: httpHost.httpCall });
		const records = yield* runSource(
			plex.run,
			{ apiKey: "key", apiUrl: "https://plex.example" },
			host,
		);
		expect(new Set(calls).size).toBe(calls.length);
		expect(
			records.flatMap((record) => record.group?.events ?? []).map((event) => event.eventSchemaSlug),
		).toEqual(["complete", "progress", "progress"]);
		expect(records[2]?.group?.events[0]?.unresolvedEpisode).toEqual({
			type: "show",
			seasonNumber: 1,
			episodeNumber: 2,
		});
	}),
);
it.live("collects Jellyfin movies and series episodes using the admitted connection options", () =>
	Effect.gen(function* () {
		const calls: string[] = [];
		const httpHost = stubHttpHost(({ url, path, options }) => {
			expect(options?.allowInsecureConnections).toBe(true);
			calls.push(path + url.search);
			if (path.endsWith("AuthenticateByName")) {
				return { body: { AccessToken: "token", User: { Id: "user" } } };
			}
			if (url.searchParams.get("IncludeItemTypes") === "Movie") {
				return {
					body: {
						Items: [
							{
								Id: "movie",
								Name: "Movie",
								ProviderIds: { Tmdb: "42" },
								UserData: { LastPlayedDate: "2026-01-01T00:00:00Z" },
							},
						],
					},
				};
			}
			if (url.searchParams.get("IncludeItemTypes") === "Series") {
				return { body: { Items: [{ Id: "series", Name: "Show", ProviderIds: { Tmdb: "99" } }] } };
			}
			return {
				body: {
					Items: [
						{
							Id: "episode",
							IndexNumber: 3,
							Name: "Episode",
							ParentIndexNumber: 2,
							UserData: { IsFavorite: true, LastPlayedDate: "2026-01-02T00:00:00Z" },
						},
					],
				},
			};
		});
		const host = defineSandboxTestHost(jellyfinManifest, { httpCall: httpHost.httpCall });
		const records = yield* runSource(
			jellyfin.run,
			{ username: "user", allowInsecureConnections: true, apiUrl: "https://jellyfin.example" },
			host,
		);
		expect(new Set(calls).size).toBe(4);
		expect(
			records.flatMap((record) => record.group?.events ?? []).map((event) => event.eventSchemaSlug),
		).toEqual(["complete", "progress"]);
		expect(
			records.find((record) => record.group?.events[0]?.eventSchemaSlug === "progress")?.group
				?.events[0]?.unresolvedEpisode,
		).toEqual({ type: "show", seasonNumber: 2, episodeNumber: 3 });
		expect(
			records.some(
				(record) => record.group?.collectionMemberships[0]?.collectionName === "Favorites",
			),
		).toBe(true);
	}),
);
it.live(
	"keeps source failures while collecting Audiobookshelf audiobook and ebook identifiers",
	() =>
		Effect.gen(function* () {
			const httpHost = stubHttpHost(({ path }) =>
				path.endsWith("/libraries")
					? { body: { libraries: [{ id: "books", name: "Books", mediaType: "book" }] } }
					: {
							body: {
								results: [
									{ id: "audio", media: { metadata: { asin: "ASIN", title: "Audio" } } },
									{
										id: "ebook",
										media: {
											ebookFormat: "epub",
											metadata: { title: "Ebook", isbn: "9780306406157" },
										},
									},
									{ id: "bad", media: { metadata: { title: "Bad" } } },
								],
							},
						},
			);
			const host = defineSandboxTestHost(audiobookshelfManifest, { httpCall: httpHost.httpCall });
			const records = yield* runSource(
				audiobookshelf.run,
				{ apiKey: "key", apiUrl: "https://abs.example" },
				host,
			);
			expect(
				records.some(
					(record) =>
						record.group?.entityRef.kind === "resolved" &&
						record.group.entityRef.externalId === "ASIN",
				),
			).toBe(true);
			expect(
				records.some(
					(record) =>
						record.group?.entityRef.kind === "unresolved" &&
						record.group.entityRef.identifierValue === "9780306406157",
				),
			).toBe(true);
			expect(records.find((record) => record.failure)?.failure).toMatchObject({
				itemIndex: 2,
				sourceIdentifier: "bad",
				stage: "input_transformation",
			});
		}),
);
it.live(
	"normalizes MediaTracker history over multiple detail windows and reuses details across capture pages",
	() =>
		Effect.gen(function* () {
			let calls = 0;
			const host = stubHttpHost(() => {
				calls++;
				return {
					body: {
						id: 1,
						tmdbId: 42,
						title: "Movie",
						seenHistory: Array.from({ length: 130 }, (_, index) => ({
							id: index,
							date: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
						})),
					},
				};
			});
			const raw: MediaSourceRecord[] = [
				{
					key: "1",
					itemIndex: 0,
					eventIndex: 0,
					operationId: "raw-0",
					raw: { item: { id: 1, mediaType: "movie" } },
				},
				{
					key: "1",
					itemIndex: 1,
					eventIndex: 0,
					operationId: "raw-1",
					raw: { list: "Backlog", item: { id: 1, mediaType: "movie" } },
				},
			];
			const fs = mediaFilesystem({});
			let carry = false;
			const records: MediaSourceRecord[] = [];
			for (const record of raw) {
				fs.files.set("records", new TextEncoder().encode(serializeMediaRecords([record])));
				let offset = 0;
				for (;;) {
					const result = yield* collectMediaTracker(
						mediaStageInput({
							offset,
							action: "normalize",
							settings: { apiKey: "key", apiUrl: "https://tracker.example" },
							ingestionArtifacts: {
								runId: "run",
								captures: { records: "records", ...(carry ? { carry: "carry" } : {}) },
							},
						}),
						host,
					);
					records.push(...(yield* fs.records()));
					offset = result.offset;
					if (result.carryFile) {
						fs.files.set("carry", fs.scratch.get(result.carryFile) ?? new Uint8Array());
						carry = true;
					}
					if (result.done) {
						break;
					}
				}
			}
			expect(calls).toBe(1);
			const events = records
				.sort(compareMediaRecords)
				.flatMap((record) => record.group?.events ?? []);
			expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(130);
			expect(events.filter((event) => event.eventSchemaSlug === "backlog")).toHaveLength(1);
			expect(new Set(events.map((event) => event.operationId)).size).toBe(131);
		}),
);
