import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./shared";

type SpotifyGroupHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

type Route = { match: (url: string) => boolean; body: unknown };

const makeHost = (
	routes: readonly Route[],
	overrides: Partial<SpotifyGroupHost> = {},
): SpotifyGroupHost =>
	defineSandboxTestHost(manifest, {
		setCachedValue: () => Effect.succeed(null),
		getCachedValue: () => Effect.succeed("cached-token"),
		getPluginConfig: (keys) =>
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
					total_tracks: 2,
					name: "The Album",
					description: "An album.",
					external_urls: { spotify: "https://open.spotify.com/album/al1" },
					images: [{ width: 300, height: 300, url: "https://img/cover.jpg" }],
					tracks: { items: [{ id: "t1", name: "First Track" }, { id: "t2" }, { name: "No Id" }] },
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
});
