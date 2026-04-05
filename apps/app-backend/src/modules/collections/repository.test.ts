import { describe, expect, it } from "bun:test";
import { toMembershipData } from "./repository";

describe("toMembershipData", () => {
	it("returns canonical member_of relationship data", () => {
		const result = toMembershipData([
			{
				id: "rel-1",
				relType: "member_of",
				properties: { rating: 5 },
				sourceEntityId: "entity-1",
				targetEntityId: "collection-1",
				createdAt: new Date("2024-01-01T00:00:00Z"),
			},
		]);

		expect(result).toEqual({
			memberOf: {
				id: "rel-1",
				relType: "member_of",
				properties: { rating: 5 },
				sourceEntityId: "entity-1",
				targetEntityId: "collection-1",
				createdAt: "2024-01-01T00:00:00.000Z",
			},
		});
	});

	it("normalizes a legacy collection relationship into canonical member_of data", () => {
		const result = toMembershipData([
			{
				id: "rel-legacy",
				relType: "collection",
				properties: { rating: 4 },
				targetEntityId: "entity-1",
				sourceEntityId: "collection-1",
				createdAt: new Date("2024-01-01T00:00:00Z"),
			},
		]);

		expect(result).toEqual({
			memberOf: {
				id: "rel-legacy",
				relType: "member_of",
				properties: { rating: 4 },
				sourceEntityId: "entity-1",
				targetEntityId: "collection-1",
				createdAt: "2024-01-01T00:00:00.000Z",
			},
		});
	});
});
