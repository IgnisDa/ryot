import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./spotify";

type SpotifyPersonHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

type Route = { match: (url: string) => boolean; body: unknown };

const makeHost = (
	routes: readonly Route[],
	overrides: Partial<SpotifyPersonHost> = {},
): SpotifyPersonHost =>
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

describe("person.spotify sandbox script", () => {
	it("uses a fixed page size of 20 for artist search regardless of pageSize input", () => {
		const searchUrls: string[] = [];
		const host = makeHost([], {
			httpCall: (_method, url) => {
				searchUrls.push(url);
				return httpSuccess({
					artists: {
						total: 1,
						items: [{ id: "a1", name: "The Artist", images: [{ url: "https://img/a.jpg" }] }],
					},
				});
			},
		});

		return runSandboxTestScript(
			search,
			{ query: "artist", page: 2, pageSize: 5 },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(searchUrls).toEqual([
					"https://api.spotify.com/v1/search?type=artist&q=artist&offset=20&limit=20",
				]);
				expect(result.items).toEqual([
					{
						externalId: "a1",
						calloutProperty: { kind: "null", value: null },
						titleProperty: { kind: "text", value: "The Artist" },
						primarySubtitleProperty: { kind: "null", value: null },
						secondarySubtitleProperty: { kind: "null", value: null },
						imageProperty: { kind: "image", value: { type: "remote", url: "https://img/a.jpg" } },
					},
				]);
				expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("groups top tracks and albums into outgoing authoritative relationships", () => {
		const host = makeHost([
			{
				match: (url) => url.includes("/albums"),
				body: {
					total: 2,
					items: [
						{ id: "al1", name: "Album One" },
						{ id: "al2", name: "Album Two" },
					],
				},
			},
			{
				match: (url) => url.includes("/top-tracks"),
				body: { tracks: [{ id: "t1", name: "Top Track" }, { name: "No Id Track" }] },
			},
			{
				match: (url) => url.includes("/artists/"),
				body: {
					id: "a1",
					name: "The Artist",
					genres: ["rock", "indie"],
					images: [{ url: "https://img/a.jpg", width: 640, height: 640 }],
					external_urls: { spotify: "https://open.spotify.com/artist/a1" },
				},
			},
		]);

		return runSandboxTestScript(details, { externalId: "a1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("The Artist");
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-music",
						entities: [
							{
								name: "Top Track",
								externalId: "t1",
								providerSlug: "music.spotify",
								relationshipProperties: { roles: ["Artist"] },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-music-group",
						entities: [
							{
								name: "Album One",
								externalId: "al1",
								providerSlug: "music-group.spotify",
								relationshipProperties: { roles: ["Artist"] },
							},
							{
								name: "Album Two",
								externalId: "al2",
								providerSlug: "music-group.spotify",
								relationshipProperties: { roles: ["Artist"] },
							},
						],
					},
				]);
				expect(result.properties).toEqual({
					alternateNames: [],
					description: "Genres: rock, indie",
					sourceUrl: "https://open.spotify.com/artist/a1",
					images: [{ type: "remote", url: "https://img/a.jpg" }],
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
