import { describe, expect, it } from "vitest";

import { adaptIgdbCsv } from "./igdb";

const IGDB_HEADERS = "id,game";

describe("adaptIgdbCsv", () => {
	it("maps each exported game into the chosen collection", () => {
		const csv = [IGDB_HEADERS, "7346,Hades", "1020,Celeste"].join("\n");

		const result = adaptIgdbCsv(csv, { collection: "Favorites" });

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toEqual([
			{
				events: [],
				itemIndex: 0,
				collectionMemberships: [{ collectionName: "Favorites" }],
				entityRef: {
					kind: "resolved",
					externalId: "7346",
					sourceLabel: "Hades",
					entitySchemaSlug: "video-game",
					providerSlug: "video-game.igdb",
				},
			},
			{
				events: [],
				itemIndex: 1,
				collectionMemberships: [{ collectionName: "Favorites" }],
				entityRef: {
					kind: "resolved",
					externalId: "1020",
					sourceLabel: "Celeste",
					entitySchemaSlug: "video-game",
					providerSlug: "video-game.igdb",
				},
			},
		]);
	});

	it("records malformed rows without stopping the rest of the file", () => {
		const csv = [IGDB_HEADERS, ",Broken Game", "99,Good Game"].join("\n");

		const result = adaptIgdbCsv(csv, { collection: "Backlog" });

		expect(result.failures).toEqual([
			{ itemIndex: 0, message: "id is empty", sourceLabel: "Broken Game" },
		]);
		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]?.collectionMemberships).toEqual([{ collectionName: "Backlog" }]);
	});
});
