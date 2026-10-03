import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./shared";

type IgdbCompanyHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown, headers: Record<string, string> = {}) =>
	Effect.succeed({ headers, status: 200, body: JSON.stringify(body) });

const makeHost = (overrides: Partial<IgdbCompanyHost>): IgdbCompanyHost =>
	defineSandboxTestHost(manifest, {
		setCachedValue: () => Effect.succeed(null),
		httpCall: () => Effect.fail({ message: "no route" }),
		getCachedValue: () => Effect.succeed({ clientId: "client-id", accessToken: "Bearer cached" }),
		getPluginConfig: (keys) =>
			Effect.succeed(
				Object.fromEntries(
					keys.map((key) => [key, key === "twitchClientId" ? "client-id" : "client-secret"]),
				),
			),
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
					return httpSuccess({ token_type: "bearer", access_token: "unexpected" });
				}
				return httpSuccess([{ id: 7, name: "Studio", logo: { image_id: "logo1" } }], {
					"x-count": "1",
				});
			},
		});

		return runSandboxTestScript(
			search,
			{ page: 1, pageSize: 20, query: "studio" },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(tokenPosts).toBe(0);
				expect(result.items).toEqual([
					{
						title: "Studio",
						externalId: "7",
						imageUrl: "https://images.igdb.com/igdb/image/upload/t_logo_med/logo1.jpg",
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
						description: "A studio.",
						start_date: 1_262_304_000,
						logo: { image_id: "logo1" },
						published: [{ id: 10, name: "Alpha" }],
						websites: [{ url: "https://studio.example" }],
						developed: [
							{ id: 10, name: "Alpha" },
							{ id: 11, name: "Beta" },
						],
					},
				]);
			},
		});

		return runSandboxTestScript(details, { externalId: "7" }, host, execution).pipe(
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
								providerSlug: "video-game.igdb",
								relationshipProperties: { roles: ["Developer", "Publisher"] },
							},
							{
								name: "Beta",
								externalId: "11",
								providerSlug: "video-game.igdb",
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
							purpose: "logo",
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
