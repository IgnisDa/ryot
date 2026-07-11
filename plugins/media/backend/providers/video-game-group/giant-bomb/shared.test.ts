import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./shared";

type GiantBombHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: GiantBombHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfig: (keys) =>
			Effect.succeed(Object.fromEntries(keys.map((key) => [key, "api-key"]))),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("video-game-group.giant-bomb sandbox script", () => {
	it("maps franchise search hits without metadata", () => {
		const host = makeHost(() =>
			httpSuccess({
				error: "OK",
				number_of_total_results: 1,
				results: [{ name: "Zelda", guid: "3025-1", image: { original_url: "https://img/f.jpg" } }],
			}),
		);

		return Effect.runPromise(
			runSandboxTestScript(search, { page: 1, pageSize: 20, query: "zelda" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{ title: "Zelda", externalId: "3025-1", imageUrl: "https://img/f.jpg" },
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
									relationshipProperties: { order: 1 },
									providerSlug: "video-game.giant-bomb",
								},
								{
									name: "Loading...",
									externalId: "3030-2",
									relationshipProperties: { order: 2 },
									providerSlug: "video-game.giant-bomb",
								},
							],
						},
					]);
					expect(result.properties).toEqual({
						parts: 2,
						description: "Series.\n\n<p>d</p>",
						sourceUrl: "https://www.giantbomb.com/zelda/",
						images: [{ type: "remote", purpose: "cover", url: "https://img/f.jpg" }],
					});
				}),
			),
		);
	});
});
