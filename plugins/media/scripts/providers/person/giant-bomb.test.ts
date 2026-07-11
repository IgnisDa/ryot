import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./giant-bomb.sandbox";

type GiantBombHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: GiantBombHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Promise.resolve({ success: true as const, data: "api-key" }),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.giant-bomb sandbox script", () => {
	it("maps search hits with birth year and image", () => {
		const host = makeHost(() =>
			httpSuccess({
				error: "OK",
				number_of_total_results: 1,
				results: [
					{
						guid: "4010-1",
						name: "Jane Dev",
						birth_date: "1980-05-02",
						image: { original_url: "https://img/p.jpg" },
					},
				],
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "jane", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "4010-1",
					calloutProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Jane Dev" },
					primarySubtitleProperty: { kind: "number", value: 1980 },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: { kind: "image", value: { type: "remote", url: "https://img/p.jpg" } },
				},
			]);
			expect(result.details).toEqual({ totalItems: 1, nextPage: null });
			return undefined;
		});
	});

	it("maps games and franchises to outgoing authoritative relationships", () => {
		const host = makeHost(() =>
			httpSuccess({
				error: "OK",
				results: {
					name: "Jane Dev",
					deck: "A dev.",
					hometown: "Tokyo",
					death_date: null,
					description: "<p>bio</p>",
					birth_date: "1980-05-02",
					image: { original_url: "https://img/p.jpg" },
					site_detail_url: "https://www.giantbomb.com/jane/",
					games: [{ name: "Game A", api_detail_url: "https://www.giantbomb.com/api/game/3030-9/" }],
					franchises: [
						{ name: "Zelda", api_detail_url: "https://www.giantbomb.com/api/franchise/3025-1/" },
					],
				},
			}),
		);

		return runSandboxTestDriver(details, { externalId: "4010-1" }, host, execution).then(
			(result) => {
				expect(result.name).toBe("Jane Dev");
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-video-game",
						entities: [
							{
								name: "Game A",
								externalId: "3030-9",
								scriptSlug: "video-game.giant-bomb",
								relationshipProperties: { roles: ["Person"] },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-video-game-group",
						entities: [
							{
								name: "Zelda",
								externalId: "3025-1",
								scriptSlug: "video-game-group.giant-bomb",
								relationshipProperties: { roles: ["Person"] },
							},
						],
					},
				]);
				expect(result.properties).toEqual({
					alternateNames: [],
					birthPlace: "Tokyo",
					deathDate: null,
					birthDate: "1980-05-02",
					description: "A dev.\n\n<p>bio</p>",
					sourceUrl: "https://www.giantbomb.com/jane/",
					images: [{ type: "remote", url: "https://img/p.jpg" }],
				});
				return undefined;
			},
		);
	});
});
