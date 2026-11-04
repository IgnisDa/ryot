import { describe, expect, it } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { spotifyPage } from "./spotify";

describe("Spotify inventory pages", () => {
	it.each([
		{ total: -1, items: [] },
		{ total: 3, offset: 0, items: [{ id: "t1" }] },
		{
			total: 3,
			offset: 1,
			items: [{ id: "t1" }],
			next: "https://api.spotify.com/v1/albums/a/tracks?offset=1",
		},
		{ total: 3, offset: 1, next: "not a URL", items: [{ id: "t1" }] },
		{
			total: 3,
			offset: 1,
			items: [{ id: "t1" }],
			next: "https://elsewhere.example/tracks?offset=2",
		},
		{
			total: 2,
			offset: 1,
			items: [{ id: "t1" }],
			next: "https://api.spotify.com/v1/albums/a/tracks?offset=2",
		},
	])("rejects inconsistent pagination metadata", (page) =>
		Effect.runPromise(
			spotifyPage(page, 1, null).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(error.message).toContain("Spotify");
				}),
			),
		),
	);

	it("uses the returned count instead of the requested limit for the next offset", () =>
		Effect.runPromise(
			spotifyPage(
				{
					total: 5,
					offset: 1,
					items: [{ id: "t1" }, { id: "t2" }],
					next: "https://api.spotify.com/v1/albums/a/tracks?offset=3",
				},
				1,
				5,
			).pipe(
				Effect.map((page) => {
					expect(page.nextOffset).toBe(3);
					expect(page.total).toBe(5);
				}),
			),
		));
});
