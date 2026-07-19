import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./igdb";

type IgdbGroupHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown, headers: Record<string, string> = {}) =>
	Effect.succeed({ status: 200, headers, body: JSON.stringify(body) });

const makeHost = (overrides: Partial<IgdbGroupHost>): IgdbGroupHost =>
	defineSandboxTestHost(manifest, {
		getCachedValue: () => Effect.succeed(null),
		setCachedValue: () => Effect.succeed(null),
		getPluginConfig: (keys) =>
			Effect.succeed(
				Object.fromEntries(
					keys.map((key) => [key, key === "twitchClientId" ? "client-id" : "client-secret"]),
				),
			),
		httpCall: () => Effect.fail({ message: "no route" }),
		...overrides,
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("video-game-group.igdb sandbox script", () => {
	it("requests a fresh token on a cache miss and maps collection search hits", () => {
		let tokenPosts = 0;
		const host = makeHost({
			httpCall: (_method, url) => {
				if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
					tokenPosts += 1;
					return httpSuccess({ access_token: "token", token_type: "bearer", expires_in: 3600 });
				}
				return httpSuccess(
					[
						{
							id: 3,
							name: "The Saga",
							games: [
								{ id: 10, name: "One", cover: { image_id: "cov1" } },
								{ id: 11, name: "Two" },
							],
						},
					],
					{ "x-count": "1" },
				);
			},
		});

		return Effect.runPromise(
			runSandboxTestScript(search, { query: "saga", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(tokenPosts).toBe(1);
					expect(result.items).toEqual([
						{
							externalId: "3",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "The Saga" },
							primarySubtitleProperty: { kind: "number", value: 2 },
							secondarySubtitleProperty: { kind: "null", value: null },
							imageProperty: {
								kind: "image",
								value: {
									type: "remote",
									url: "https://images.igdb.com/igdb/image/upload/t_cover_big/cov1.jpg",
								},
							},
						},
					]);
					expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				}),
			),
		);
	});

	it("orders member games and drops version children", () => {
		const host = makeHost({
			httpCall: (_method, url) => {
				if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
					return httpSuccess({ access_token: "token", token_type: "bearer", expires_in: 3600 });
				}
				return httpSuccess([
					{
						id: 3,
						name: "The Saga",
						games: [
							{ id: 10, name: "One" },
							{ id: 99, name: "One: GOTY", version_parent: 10 },
							{ id: 11, name: "Two" },
						],
					},
				]);
			},
		});

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "3" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("The Saga");
					expect(result.properties).toEqual({
						parts: 2,
						images: [],
						sourceUrl: "https://www.igdb.com/collection/the-saga",
					});
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "video-game-group-to-video-game",
							entities: [
								{
									name: "One",
									externalId: "10",
									providerSlug: "video-game.igdb",
									relationshipProperties: { order: 1 },
								},
								{
									name: "Two",
									externalId: "11",
									providerSlug: "video-game.igdb",
									relationshipProperties: { order: 2 },
								},
							],
						},
					]);
				}),
			),
		);
	});
});
