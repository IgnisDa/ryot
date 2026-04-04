import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./giant-bomb.sandbox";

type GiantBombHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: GiantBombHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Effect.succeed("api-key"),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("company.giant-bomb sandbox script", () => {
	it("maps search hits with a null primary subtitle", () => {
		const host = makeHost(() =>
			httpSuccess({
				error: "OK",
				number_of_total_results: 1,
				results: [
					{ guid: "4010-1", name: "Studio X", image: { original_url: "https://img/c.jpg" } },
				],
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "studio", page: 1, pageSize: 20 },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(result.items).toEqual([
					{
						externalId: "4010-1",
						calloutProperty: { kind: "null", value: null },
						titleProperty: { kind: "text", value: "Studio X" },
						primarySubtitleProperty: { kind: "null", value: null },
						secondarySubtitleProperty: { kind: "null", value: null },
						imageProperty: { kind: "image", value: { type: "remote", url: "https://img/c.jpg" } },
					},
				]);
				expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("merges developer and publisher roles for the same game", () => {
		const host = makeHost(() =>
			httpSuccess({
				error: "OK",
				results: {
					name: "Studio X",
					deck: "Maker.",
					aliases: "StudioX\nSX",
					location_state: null,
					location_city: "Kyoto",
					location_country: "Japan",
					date_founded: "1995-03-01",
					description: "<p>desc</p>",
					website: "https://studiox.com",
					image: { original_url: "https://img/c.jpg" },
					site_detail_url: "https://www.giantbomb.com/studiox/",
					developed_games: [
						{ guid: "3030-1", name: "Game One", api_detail_url: "https://x/api/game/3030-1/" },
					],
					published_games: [{ guid: "3030-1", name: "Game One" }],
				},
			}),
		);

		return runSandboxTestDriver(details, { externalId: "4010-1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("Studio X");
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "company-to-video-game",
						entities: [
							{
								name: "Game One",
								externalId: "3030-1",
								scriptSlug: "video-game.giant-bomb",
								relationshipProperties: { roles: ["Developer", "Publisher"] },
							},
						],
					},
				]);
				expect(result.properties).toEqual({
					foundedYear: 1995,
					headquarters: "Kyoto, Japan",
					website: "https://studiox.com",
					alternateNames: ["StudioX", "SX"],
					description: "Maker.\n\n<p>desc</p>",
					sourceUrl: "https://www.giantbomb.com/studiox/",
					images: [{ type: "remote", url: "https://img/c.jpg" }],
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
