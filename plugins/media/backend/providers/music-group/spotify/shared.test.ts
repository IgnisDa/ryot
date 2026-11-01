import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { assert, describe, expect, it } from "vitest";

import { mediaFailureMessage } from "../../../lib/error-message";
import relatedScript, { manifest as relatedManifest } from "./related.sandbox";
import { details, manifest, related, search } from "./shared";

type SpotifyGroupHost = Pick<
	ScriptHost,
	"httpCall" | "getCachedValue" | "setCachedValue" | "getPluginConfig"
>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

type Route = { body: unknown; match: (url: string) => boolean };

const makeHost = (routes: readonly Route[], overrides: Partial<SpotifyGroupHost> = {}) =>
	defineSandboxTestHost(manifest, {
		setCachedValue: () => Effect.succeed(null),
		getCachedValue: () => Effect.succeed("cached-token"),
		getPluginConfig: ({ required: keys = [] }) =>
			Effect.succeed(
				Object.fromEntries(keys.map((key) => [key, key.endsWith("Secret") ? "secret" : "id"])),
			),
		httpCall: (_method, url) => {
			const route = routes.find((candidate) => candidate.match(url));
			return route ? httpSuccess(route.body) : Effect.fail({ message: `no route: ${url}` });
		},
		...overrides,
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("music-group.spotify sandbox script", () => {
	it("maps album search hits and drops entries missing an id or name", () => {
		const host = makeHost([
			{
				match: (url) => url.includes("/search"),
				body: {
					albums: {
						total: 3,
						items: [
							{
								id: "al1",
								total_tracks: 12,
								name: "Album One",
								images: [
									{ width: 64, height: 64, url: "https://img/small.jpg" },
									{ width: 640, height: 640, url: "https://img/big.jpg" },
								],
							},
							{ name: "", id: "al2" },
							{ name: "No Id" },
						],
					},
				},
			},
		]);

		return Effect.runPromise(
			runSandboxTestScript(search, { page: 1, pageSize: 20, query: "album" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							metadata: [12],
							externalId: "al1",
							title: "Album One",
							imageUrl: "https://img/big.jpg",
						},
					]);
					expect(result.details).toEqual({ totalItems: 3, nextPage: null });
				}),
			),
		);
	});

	it("uses a fixed page size of 10 for album search regardless of pageSize input", () => {
		const searchUrls: string[] = [];
		const host = makeHost([], {
			httpCall: (_method, url) => {
				searchUrls.push(url);
				return httpSuccess({ albums: { total: 0, items: [] } });
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { page: 2, pageSize: 20, query: "album" }, host, execution).pipe(
				Effect.map((result) => {
					expect(searchUrls).toEqual([
						"https://api.spotify.com/v1/search?type=album&q=album&offset=10&limit=10",
					]);
					expect(result.details).toEqual({ totalItems: 0, nextPage: null });
					return undefined;
				}),
			),
		);
	});

	it("maps album tracks into an ordered outgoing group with a loading placeholder", () => {
		const host = makeHost([
			{
				match: (url) => url.includes("/albums/"),
				body: {
					id: "al1",
					artists: [],
					total_tracks: 2,
					name: "The Album",
					description: "An album.",
					external_urls: { spotify: "https://open.spotify.com/album/al1" },
					images: [{ width: 300, height: 300, url: "https://img/cover.jpg" }],
					tracks: {
						total: 2,
						offset: 0,
						next: null,
						items: [{ id: "t1", name: "First Track" }, { id: "t2" }],
					},
				},
			},
		]);

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "al1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("The Album");
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "music-group-to-music",
							entities: [
								{
									externalId: "t1",
									name: "First Track",
									providerSlug: "music.spotify",
									relationshipProperties: { order: 1 },
								},
								{
									externalId: "t2",
									name: "Loading...",
									providerSlug: "music.spotify",
									relationshipProperties: { order: 2 },
								},
							],
						},
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "person-to-music-group",
						},
					]);
					expect(result.properties).toEqual({
						parts: 2,
						description: "An album.",
						sourceUrl: "https://open.spotify.com/album/al1",
						images: [{ type: "remote", purpose: "cover", url: "https://img/cover.jpg" }],
					});
				}),
			),
		);
	});

	it("keeps appeared-on album artist credits additive when they name someone else", () => {
		const host = makeHost([
			{
				match: (url) => url.includes("/albums/al0"),
				body: {
					id: "al0",
					total_tracks: 0,
					name: "Featured Appearance",
					tracks: { total: 0, offset: 0, items: [] },
					artists: [{ id: "a2", name: "Someone Else" }],
				},
			},
		]);

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "al0" }, host, execution).pipe(
				Effect.map((result) => {
					const artistCredits = result.relatedEntityGroups?.[1];
					expect(artistCredits).toMatchObject({
						direction: "incoming",
						synchronization: "additive",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "person-to-music-group",
						entities: [{ externalId: "a2", name: "Someone Else", providerSlug: "person.spotify" }],
					});
				}),
			),
		);
	});

	it("declares the canonical related entrypoint", () => {
		expect([relatedManifest.slug, relatedScript.operation]).toEqual([
			"music-group.spotify.related",
			"related",
		]);
	});

	it("pages every album track in order through three pages without fetching track details", () => {
		const offsets: number[] = [];
		const host = makeHost([], {
			httpCall: (_method, url) => {
				const request = new URL(url);
				if (request.pathname === "/v1/albums/al1") {
					return httpSuccess({
						artists: [],
						name: "Album",
						total_tracks: 5,
						tracks: { total: 5, offset: 0, items: [{ id: "t0", name: "First" }] },
					});
				}
				expect(request.pathname).toBe("/v1/albums/al1/tracks");
				expect(request.searchParams.get("limit")).toBe("50");
				const offset = Number(request.searchParams.get("offset"));
				offsets.push(offset);
				return httpSuccess({
					offset,
					total: 5,
					items: offset === 1 ? [{ id: "t1" }, { id: "t1" }] : [{ id: "t3" }, { id: "t4" }],
				});
			},
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				const root = yield* runSandboxTestScript(details, { externalId: "al1" }, host, execution);
				const group = root.relatedEntityGroups?.[0];
				assert(group?.coverage.status === "more");
				expect(group.coverage.continuation).toEqual({ total: 5, offset: 1 });
				expect(group.synchronization).toBe("authoritative");
				const result = yield* runSandboxTestScript(
					related,
					{
						externalId: "al1",
						direction: "outgoing",
						continuation: group.coverage.continuation,
						relationshipSchemaSlug: "music-group-to-music",
					},
					host,
					execution,
				);
				expect(offsets).toEqual([1, 3]);
				expect(result.coverage).toEqual({ status: "complete" });
				expect(result.entities).toEqual([
					{
						externalId: "t1",
						name: "Loading...",
						providerSlug: "music.spotify",
						relationshipProperties: { order: 2 },
					},
					{
						externalId: "t3",
						name: "Loading...",
						providerSlug: "music.spotify",
						relationshipProperties: { order: 4 },
					},
					{
						externalId: "t4",
						name: "Loading...",
						providerSlug: "music.spotify",
						relationshipProperties: { order: 5 },
					},
				]);
			}),
		);
	});

	it("keeps track offsets durable when paging needs another execution", () => {
		const offsets: number[] = [];
		const host = makeHost([], {
			httpCall: (_method, url) => {
				const request = new URL(url);
				expect(request.pathname).toBe("/v1/albums/al1/tracks");
				const offset = Number(request.searchParams.get("offset"));
				offsets.push(offset);
				return httpSuccess({ offset, total: 43, items: [{ id: `t${offset}` }] });
			},
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* runSandboxTestScript(
					related,
					{
						externalId: "al1",
						direction: "outgoing",
						continuation: { offset: 1, total: 43 },
						relationshipSchemaSlug: "music-group-to-music",
					},
					host,
					execution,
				);
				assert(first.coverage.status === "more");
				expect(offsets).toHaveLength(40);
				expect(first.entities).toHaveLength(40);
				expect(first.coverage.continuation).toEqual({ total: 43, offset: 41 });
				const last = yield* runSandboxTestScript(
					related,
					{
						externalId: "al1",
						direction: "outgoing",
						continuation: first.coverage.continuation,
						relationshipSchemaSlug: "music-group-to-music",
					},
					host,
					execution,
				);
				expect(last).toEqual({
					coverage: { status: "complete" },
					entities: [
						{
							externalId: "t41",
							name: "Loading...",
							providerSlug: "music.spotify",
							relationshipProperties: { order: 42 },
						},
						{
							externalId: "t42",
							name: "Loading...",
							providerSlug: "music.spotify",
							relationshipProperties: { order: 43 },
						},
					],
				});
			}),
		);
	});

	it.each([
		{},
		{ total: 3, items: [] },
		{ total: 4, items: [{ id: "t1" }] },
		{ total: 3, next: null, items: [{ id: "t1" }] },
		{ total: 3, items: [{ name: "Missing ID" }] },
	])("rejects malformed or inconsistent track pages instead of completing", (body) => {
		const host = makeHost([], { httpCall: () => httpSuccess(body) });
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					externalId: "al1",
					direction: "outgoing",
					continuation: { total: 3, offset: 1 },
					relationshipSchemaSlug: "music-group-to-music",
				},
				host,
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(mediaFailureMessage(error)).toContain("Spotify");
				}),
			),
		);
	});

	it("does not complete an album if its middle track page fails", () => {
		const offsets: number[] = [];
		const host = makeHost([], {
			httpCall: (_method, url) => {
				const offset = Number(new URL(url).searchParams.get("offset"));
				offsets.push(offset);
				return offset === 2
					? Effect.fail({ message: "track page unavailable" })
					: httpSuccess({ offset, total: 4, items: [{ id: `t${offset}` }] });
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					externalId: "al1",
					direction: "outgoing",
					continuation: { total: 4, offset: 0 },
					relationshipSchemaSlug: "music-group-to-music",
				},
				host,
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(mediaFailureMessage(error)).toContain("track page unavailable");
					expect(offsets).toEqual([0, 1, 2]);
				}),
			),
		);
	});

	it("reports forbidden tracks as source-limited instead of a complete empty membership", () => {
		const host = makeHost([], {
			httpCall: () =>
				Effect.fail({ message: "HTTP 403", data: { status: 403, body: "Forbidden" } }),
		});
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					externalId: "al1",
					direction: "outgoing",
					continuation: { total: 3, offset: 1 },
					relationshipSchemaSlug: "music-group-to-music",
				},
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						entities: [],
						coverage: {
							status: "source-limited",
							reason: "Spotify denied access to this album's track inventory (HTTP 403)",
						},
					});
				}),
			),
		);
	});
});
