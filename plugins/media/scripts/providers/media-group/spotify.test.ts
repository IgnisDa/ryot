import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./spotify.sandbox";

type SpotifyGroupHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

type Route = { match: (url: string) => boolean; body: unknown };

const makeHost = (
	routes: readonly Route[],
	overrides: Partial<SpotifyGroupHost> = {},
): SpotifyGroupHost =>
	defineSandboxTestHost(manifest, {
		getAppConfigValue: (key) => Effect.succeed(key.endsWith("Secret") ? "secret" : "id"),
		getCachedValue: () => Effect.succeed("cached-token"),
		setCachedValue: () => Effect.succeed(null),
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
								name: "Album One",
								total_tracks: 12,
								images: [
									{ url: "https://img/small.jpg", width: 64, height: 64 },
									{ url: "https://img/big.jpg", width: 640, height: 640 },
								],
							},
							{ id: "al2", name: "" },
							{ name: "No Id" },
						],
					},
				},
			},
		]);

		return Effect.runPromise(
			runSandboxTestDriver(search, { query: "album", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							externalId: "al1",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "Album One" },
							primarySubtitleProperty: { kind: "number", value: 12 },
							secondarySubtitleProperty: { kind: "null", value: null },
							imageProperty: {
								kind: "image",
								value: { type: "remote", url: "https://img/big.jpg" },
							},
						},
					]);
					expect(result.details).toEqual({ totalItems: 3, nextPage: null });
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
					total_tracks: 2,
					name: "The Album",
					description: "An album.",
					external_urls: { spotify: "https://open.spotify.com/album/al1" },
					images: [{ url: "https://img/cover.jpg", width: 300, height: 300 }],
					tracks: {
						items: [{ id: "t1", name: "First Track" }, { id: "t2" }, { name: "No Id" }],
					},
				},
			},
		]);

		return Effect.runPromise(
			runSandboxTestDriver(details, { externalId: "al1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("The Album");
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "music-group-to-music",
							entities: [
								{
									name: "First Track",
									externalId: "t1",
									scriptSlug: "music.spotify",
									relationshipProperties: { order: 1 },
								},
								{
									name: "Loading...",
									externalId: "t2",
									scriptSlug: "music.spotify",
									relationshipProperties: { order: 2 },
								},
							],
						},
					]);
					expect(result.properties).toEqual({
						parts: 2,
						description: "An album.",
						sourceUrl: "https://open.spotify.com/album/al1",
						images: [{ type: "remote", url: "https://img/cover.jpg" }],
					});
				}),
			),
		);
	});
});
