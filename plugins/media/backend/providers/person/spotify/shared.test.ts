import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { assert, describe, expect, it } from "vitest";

import { mediaFailureMessage } from "../../../lib/error-message";
import type { SpotifyHost } from "../../../lib/vendors/spotify";
import relatedScript, { manifest as relatedManifest } from "./related.sandbox";
import { details, manifest, related, search } from "./shared";

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const forbidden = () =>
	Effect.fail({ message: "HTTP 403", data: { status: 403, headers: {}, body: "Forbidden" } });
const makeHost = (route: (request: URL) => unknown, overrides: Partial<SpotifyHost> = {}) =>
	defineSandboxTestHost(manifest, {
		getPluginConfig: () => Effect.succeed({}),
		setCachedValue: () => Effect.succeed(null),
		getCachedValue: () => Effect.succeed("cached-token"),
		httpCall: (_method, url) => {
			const body = route(new URL(url));
			return body === null ? Effect.fail({ message: "catalog unavailable" }) : httpSuccess(body);
		},
		...overrides,
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
const artist = {
	id: "a1",
	images: [],
	name: "The Artist",
	genres: ["rock", "indie"],
	external_urls: { spotify: "https://open.spotify.com/artist/a1" },
};
const relatedInput = { externalId: "a1", direction: "outgoing" as const };

describe("person.spotify sandbox script", () => {
	it("declares the canonical related entrypoint", () => {
		expect([relatedManifest.slug, relatedScript.operation]).toEqual([
			"person.spotify.related",
			"related",
		]);
	});

	it("uses a fixed page size of 10 for artist search", () => {
		const host = makeHost((request) => {
			expect(request.href).toBe(
				"https://api.spotify.com/v1/search?type=artist&q=artist&offset=10&limit=10",
			);
			return {
				artists: {
					total: 1,
					items: [{ id: "a1", name: "The Artist", images: [{ url: "https://img/a.jpg" }] }],
				},
			};
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { page: 2, pageSize: 5, query: "artist" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{ externalId: "a1", title: "The Artist", imageUrl: "https://img/a.jpg" },
					]);
					expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				}),
			),
		);
	});

	it("enumerates all catalog groups and artist-matching tracks over three pages without recursive population or top tracks", () => {
		const requests: string[] = [];
		const host = makeHost((request) => {
			requests.push(`${request.pathname}?${request.searchParams}`);
			if (request.pathname === "/v1/artists/a1") {
				return artist;
			}
			const offset = Number(request.searchParams.get("offset"));
			if (request.pathname === "/v1/artists/a1/albums") {
				expect(request.searchParams.get("limit")).toBe("10");
				expect(request.searchParams.get("include_groups")).toBe(
					"album,single,appears_on,compilation",
				);
				return {
					offset,
					total: 3,
					items: [
						{
							id: `al${offset}`,
							name: `Album ${offset}`,
							...(offset === 0 ? { album_type: "appears_on" } : {}),
						},
					],
				};
			}
			expect(request.searchParams.get("limit")).toBe("50");
			expect(request.pathname).toMatch(/^\/v1\/albums\/al[012]\/tracks$/);
			const id = request.pathname.split("/")[3];
			if (id === "al0") {
				return {
					offset,
					total: 3,
					items: [
						{
							name: `Track ${offset}`,
							artists: [{ id: "a1" }],
							id: offset === 1 ? "t0" : `t${offset}`,
						},
					],
				};
			}
			return {
				offset,
				total: 2,
				items: [
					{ id: "other", name: "Other artist", artists: [{ id: "a2" }] },
					{ id: "appearance", name: "Guest track", artists: [{ id: "a2" }, { id: "a1" }] },
				],
			};
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* runSandboxTestScript(details, { externalId: "a1" }, host, execution);
				expect(root.properties).toEqual({
					images: [],
					alternateNames: [],
					description: "Genres\\: rock\\, indie",
					sourceUrl: "https://open.spotify.com/artist/a1",
				});
				const tracks = root.relatedEntityGroups?.[0];
				const albums = root.relatedEntityGroups?.[1];
				assert(tracks?.coverage.status === "more" && albums?.coverage.status === "more");
				expect(tracks.entities).toEqual([]);
				expect(tracks.synchronization).toBe("additive");
				expect(albums.synchronization).toBe("authoritative");
				const songs = yield* runSandboxTestScript(
					related,
					{
						...relatedInput,
						relationshipSchemaSlug: "person-to-music",
						continuation: tracks.coverage.continuation,
					},
					host,
					execution,
				);
				expect(songs.coverage).toEqual({ status: "complete" });
				expect(songs.entities).toEqual([
					{
						name: "Track 0",
						externalId: "t0",
						providerSlug: "music.spotify",
						relationshipProperties: { roles: ["Artist"] },
					},
					{
						name: "Track 2",
						externalId: "t2",
						providerSlug: "music.spotify",
						relationshipProperties: { roles: ["Artist"] },
					},
					{
						name: "Guest track",
						externalId: "appearance",
						providerSlug: "music.spotify",
						relationshipProperties: { roles: ["Artist"] },
					},
				]);
				const catalog = yield* runSandboxTestScript(
					related,
					{
						...relatedInput,
						continuation: albums.coverage.continuation,
						relationshipSchemaSlug: "person-to-music-group",
					},
					host,
					execution,
				);
				expect(catalog.coverage).toEqual({ status: "complete" });
				expect(
					[...albums.entities, ...catalog.entities].map((entity) => entity.externalId),
				).toEqual(["al0", "al1", "al2"]);
				expect(
					requests.every(
						(path) =>
							path.startsWith("/v1/artists/a1?") ||
							path.startsWith("/v1/artists/a1/albums?") ||
							/^\/v1\/albums\/al[012]\/tracks\?/.test(path),
					),
				).toBe(true);
			}),
		);
	});

	it("keeps album and track paging durable beyond one execution", () => {
		const offsets: number[] = [];
		const host = makeHost((request) => {
			if (request.pathname === "/v1/artists/a1") {
				return artist;
			}
			if (request.pathname === "/v1/artists/a1/albums") {
				return { total: 1, offset: 0, items: [{ id: "huge", name: "Huge" }] };
			}
			expect(request.pathname).toBe("/v1/albums/huge/tracks");
			const offset = Number(request.searchParams.get("offset"));
			offsets.push(offset);
			return { offset, total: 43, items: [{ id: `t${offset}`, artists: [{ id: "a1" }] }] };
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* runSandboxTestScript(details, { externalId: "a1" }, host, execution);
				const group = root.relatedEntityGroups?.[0];
				assert(group?.coverage.status === "more");
				const first = yield* runSandboxTestScript(
					related,
					{
						...relatedInput,
						relationshipSchemaSlug: "person-to-music",
						continuation: group.coverage.continuation,
					},
					host,
					execution,
				);
				assert(first.coverage.status === "more");
				expect(offsets).toHaveLength(40);
				expect(first.entities).toHaveLength(40);
				expect(
					new TextEncoder().encode(
						yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
							first.coverage.continuation,
						),
					).byteLength,
				).toBeLessThan(4096);
				const last = yield* runSandboxTestScript(
					related,
					{
						...relatedInput,
						relationshipSchemaSlug: "person-to-music",
						continuation: first.coverage.continuation,
					},
					host,
					execution,
				);
				expect(last.coverage).toEqual({ status: "complete" });
				expect(last.entities.map((entity) => entity.externalId)).toEqual(["t40", "t41", "t42"]);
			}),
		);
	});

	it("resumes album discovery independently after forty pages and deduplicates repeats", () => {
		const offsets: number[] = [];
		const host = makeHost((request) => {
			expect(request.pathname).toBe("/v1/artists/a1/albums");
			const offset = Number(request.searchParams.get("offset"));
			offsets.push(offset);
			return { offset, total: 43, items: [{ id: offset < 2 ? "duplicate" : `al${offset}` }] };
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* runSandboxTestScript(
					related,
					{
						...relatedInput,
						continuation: { offset: 0, total: 43 },
						relationshipSchemaSlug: "person-to-music-group",
					},
					host,
					execution,
				);
				assert(first.coverage.status === "more");
				expect(first.entities).toHaveLength(39);
				expect(offsets).toHaveLength(40);
				const last = yield* runSandboxTestScript(
					related,
					{
						...relatedInput,
						continuation: first.coverage.continuation,
						relationshipSchemaSlug: "person-to-music-group",
					},
					host,
					execution,
				);
				expect(last.coverage).toEqual({ status: "complete" });
				expect(last.entities.map((entity) => entity.externalId)).toEqual(["al40", "al41", "al42"]);
			}),
		);
	});

	it("resumes catalog traversal with pending albums across executions", () => {
		const albumOffsets: number[] = [];
		const fetchedAlbums: string[] = [];
		const host = makeHost((request) => {
			if (request.pathname === "/v1/artists/a1") {
				return artist;
			}
			if (request.pathname === "/v1/artists/a1/albums") {
				const offset = Number(request.searchParams.get("offset"));
				albumOffsets.push(offset);
				return {
					offset,
					total: 45,
					items: Array.from({ length: Math.min(10, 45 - offset) }, (_, index) => ({
						id: `al${offset + index}`,
					})),
				};
			}
			const albumId = request.pathname.split("/")[3] ?? "";
			fetchedAlbums.push(albumId);
			expect(request.pathname).toBe(`/v1/albums/${albumId}/tracks`);
			return { total: 1, offset: 0, items: [{ id: `t${albumId}`, artists: [{ id: "a1" }] }] };
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* runSandboxTestScript(details, { externalId: "a1" }, host, execution);
				const group = root.relatedEntityGroups?.[0];
				assert(group?.coverage.status === "more");
				const first = yield* runSandboxTestScript(
					related,
					{
						...relatedInput,
						relationshipSchemaSlug: "person-to-music",
						continuation: group.coverage.continuation,
					},
					host,
					execution,
				);
				assert(first.coverage.status === "more");
				expect(first.entities).toHaveLength(37);
				expect(first.coverage.continuation).toEqual({
					trackOffset: 0,
					albumsTotal: 45,
					albumsOffset: 40,
					trackTotal: null,
					pending: ["al37", "al38", "al39"],
				});
				const last = yield* runSandboxTestScript(
					related,
					{
						...relatedInput,
						relationshipSchemaSlug: "person-to-music",
						continuation: first.coverage.continuation,
					},
					host,
					execution,
				);
				expect(last.coverage).toEqual({ status: "complete" });
				expect([...first.entities, ...last.entities].map((entity) => entity.externalId)).toEqual(
					Array.from({ length: 45 }, (_, index) => `tal${index}`),
				);
				expect(albumOffsets).toEqual([0, 10, 20, 30, 40]);
				expect(fetchedAlbums).toEqual(Array.from({ length: 45 }, (_, index) => `al${index}`));
			}),
		);
	});

	it("reports source-limited coverage instead of authoritative empty songs when the catalog returns 403", () => {
		const requested: string[] = [];
		const host = makeHost(() => null, {
			httpCall: (_method, url) => {
				requested.push(new URL(url).pathname);
				return url.includes("/albums") ? forbidden() : httpSuccess(artist);
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "a1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("The Artist");
					expect(
						result.relatedEntityGroups?.map((group) => [group.synchronization, group.coverage]),
					).toEqual([
						[
							"additive",
							{
								status: "source-limited",
								reason: "Spotify denied access to the artist's album or track catalog (HTTP 403)",
							},
						],
						[
							"authoritative",
							{
								status: "source-limited",
								reason: "Spotify denied access to the artist's album or track catalog (HTTP 403)",
							},
						],
					]);
					expect(requested).toEqual(["/v1/artists/a1", "/v1/artists/a1/albums"]);
				}),
			),
		);
	});

	it("reports a source limit when a catalog album's tracks are forbidden", () => {
		const host = makeHost(() => null, { httpCall: () => forbidden() });
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					...relatedInput,
					relationshipSchemaSlug: "person-to-music",
					continuation: {
						albumsTotal: 1,
						trackOffset: 0,
						albumsOffset: 1,
						pending: ["al1"],
						trackTotal: null,
					},
				},
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result.coverage).toEqual({
						status: "source-limited",
						reason: "Spotify denied access to the artist's album or track catalog (HTTP 403)",
					});
				}),
			),
		);
	});

	it.each([
		{},
		{ total: 3, items: [] },
		{ total: 4, items: [{ id: "t1" }] },
		{ total: 3, items: [{ name: "No ID" }] },
	])("does not silently complete malformed catalog pages", (body) => {
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					...relatedInput,
					continuation: { total: 3, offset: 1 },
					relationshipSchemaSlug: "person-to-music-group",
				},
				makeHost(() => body),
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(mediaFailureMessage(error)).toContain("Spotify");
				}),
			),
		);
	});

	it("fails a whole track batch on a middle-page failure", () => {
		const seen: number[] = [];
		const host = makeHost((request) => {
			const offset = Number(request.searchParams.get("offset"));
			seen.push(offset);
			return offset === 2
				? null
				: { offset, total: 4, items: [{ id: `t${offset}`, artists: [{ id: "a1" }] }] };
		});
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					...relatedInput,
					relationshipSchemaSlug: "person-to-music",
					continuation: {
						albumsTotal: 1,
						trackOffset: 0,
						albumsOffset: 1,
						pending: ["al1"],
						trackTotal: null,
					},
				},
				host,
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(mediaFailureMessage(error)).toContain("catalog unavailable");
					expect(seen).toEqual([0, 1, 2]);
				}),
			),
		);
	});
});
