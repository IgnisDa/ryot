import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./giant-bomb";

type GiantBombHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: GiantBombHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Effect.succeed("api-key"),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("video-game-group.giant-bomb sandbox script", () => {
	it("maps franchise search hits with a null primary subtitle", () => {
		const host = makeHost(() =>
			httpSuccess({
				error: "OK",
				number_of_total_results: 1,
				results: [{ guid: "3025-1", name: "Zelda", image: { original_url: "https://img/f.jpg" } }],
			}),
		);

		return Effect.runPromise(
			runSandboxTestScript(search, { query: "zelda", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							externalId: "3025-1",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "Zelda" },
							primarySubtitleProperty: { kind: "null", value: null },
							secondarySubtitleProperty: { kind: "null", value: null },
							imageProperty: { kind: "image", value: { type: "remote", url: "https://img/f.jpg" } },
						},
					]);
					expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				}),
			),
		);
	});

	it("orders franchise members and defaults missing names to Loading", () => {
		const host = makeHost(() =>
			httpSuccess({
				error: "OK",
				results: {
					name: "Zelda",
					deck: "Series.",
					description: "<p>d</p>",
					image: { original_url: "https://img/f.jpg" },
					site_detail_url: "https://www.giantbomb.com/zelda/",
					games: [
						{ name: "Zelda I", api_detail_url: "https://www.giantbomb.com/api/game/3030-1/" },
						{ api_detail_url: "https://www.giantbomb.com/api/game/3030-2/" },
					],
				},
			}),
		);

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "3025-1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("Zelda");
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "video-game-group-to-video-game",
							entities: [
								{
									name: "Zelda I",
									externalId: "3030-1",
									providerSlug: "video-game.giant-bomb",
									relationshipProperties: { order: 1 },
								},
								{
									name: "Loading...",
									externalId: "3030-2",
									providerSlug: "video-game.giant-bomb",
									relationshipProperties: { order: 2 },
								},
							],
						},
					]);
					expect(result.properties).toEqual({
						parts: 2,
						description: "Series.\n\n<p>d</p>",
						sourceUrl: "https://www.giantbomb.com/zelda/",
						images: [{ type: "remote", url: "https://img/f.jpg" }],
					});
				}),
			),
		);
	});
});
