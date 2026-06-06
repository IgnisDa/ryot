import { describe, expect, it } from "bun:test";

import { adaptIgdbCsv } from "./adapter";

const IGDB_HEADERS = "id,game";

describe("adaptIgdbCsv", () => {
	it("maps each exported game into the chosen collection", () => {
		const csv = [IGDB_HEADERS, "7346,Hades", "1020,Celeste"].join("\n");

		const result = adaptIgdbCsv(csv, { collection: "Favorites" });

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toEqual([
			{
				itemIndex: 0,
				events: [],
				collectionMemberships: [{ collectionName: "Favorites" }],
				entityRef: {
					kind: "resolved",
					externalId: "7346",
					sourceLabel: "Hades",
					scriptSlug: "video-game.igdb",
					entitySchemaSlug: "video-game",
				},
			},
			{
				itemIndex: 1,
				events: [],
				collectionMemberships: [{ collectionName: "Favorites" }],
				entityRef: {
					kind: "resolved",
					externalId: "1020",
					sourceLabel: "Celeste",
					scriptSlug: "video-game.igdb",
					entitySchemaSlug: "video-game",
				},
			},
		]);
	});

	it("records malformed rows without stopping the rest of the file", () => {
		const csv = [IGDB_HEADERS, ",Broken Game", "99,Good Game"].join("\n");

		const result = adaptIgdbCsv(csv, { collection: "Backlog" });

		expect(result.failures).toEqual([
			{ itemIndex: 0, sourceLabel: "Broken Game", message: "id is empty" },
		]);
		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]?.collectionMemberships).toEqual([{ collectionName: "Backlog" }]);
	});
});
