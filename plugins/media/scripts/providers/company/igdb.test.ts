import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./igdb.sandbox";

type IgdbCompanyHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown, headers: Record<string, string> = {}) =>
	Effect.succeed({ status: 200, headers, body: JSON.stringify(body) });

const makeHost = (overrides: Partial<IgdbCompanyHost>): IgdbCompanyHost =>
	defineSandboxTestHost(manifest, {
		getCachedValue: () => Effect.succeed({ accessToken: "Bearer cached", clientId: "client-id" }),
		setCachedValue: () => Effect.succeed(null),
		getAppConfigValue: (key) =>
			Effect.succeed(key === "videoGames.twitchClientId" ? "client-id" : "client-secret"),
		httpCall: () => Effect.fail({ message: "no route" }),
		...overrides,
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("company.igdb sandbox script", () => {
	it("maps company search hits and reuses the cached token", () => {
		let tokenPosts = 0;
		const host = makeHost({
			httpCall: (_method, url) => {
				if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
					tokenPosts += 1;
					return httpSuccess({ access_token: "unexpected", token_type: "bearer" });
				}
				return httpSuccess([{ id: 7, name: "Studio", logo: { image_id: "logo1" } }], {
					"x-count": "1",
				});
			},
		});

		return runSandboxTestDriver(
			search,
			{ query: "studio", page: 1, pageSize: 20 },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(tokenPosts).toBe(0);
				expect(result.items).toEqual([
					{
						externalId: "7",
						calloutProperty: { kind: "null", value: null },
						titleProperty: { kind: "text", value: "Studio" },
						primarySubtitleProperty: { kind: "null", value: null },
						secondarySubtitleProperty: { kind: "null", value: null },
						imageProperty: {
							kind: "image",
							value: {
								type: "remote",
								url: "https://images.igdb.com/igdb/image/upload/t_logo_med/logo1.jpg",
							},
						},
					},
				]);
				expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("groups developed and published games, merging duplicate roles", () => {
		const host = makeHost({
			httpCall: (_method, url) => {
				if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
					return httpSuccess({ access_token: "unexpected" });
				}
				return httpSuccess([
					{
						id: 7,
						name: "Studio",
						start_date: 1_262_304_000,
						description: "A studio.",
						logo: { image_id: "logo1" },
						websites: [{ url: "https://studio.example" }],
						developed: [
							{ id: 10, name: "Alpha" },
							{ id: 11, name: "Beta" },
						],
						published: [{ id: 10, name: "Alpha" }],
					},
				]);
			},
		});

		return runSandboxTestDriver(details, { externalId: "7" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("Studio");
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "company-to-video-game",
						entities: [
							{
								name: "Alpha",
								externalId: "10",
								scriptSlug: "video-game.igdb",
								relationshipProperties: { roles: ["Developer", "Publisher"] },
							},
							{
								name: "Beta",
								externalId: "11",
								scriptSlug: "video-game.igdb",
								relationshipProperties: { roles: ["Developer"] },
							},
						],
					},
				]);
				expect(result.properties).toEqual({
					foundedYear: 2010,
					alternateNames: [],
					description: "A studio.",
					website: "https://studio.example",
					sourceUrl: "https://www.igdb.com/companies/7",
					images: [
						{
							type: "remote",
							url: "https://images.igdb.com/igdb/image/upload/t_logo_med/logo1.jpg",
						},
					],
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
