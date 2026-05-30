import { describe, expect, it } from "vitest";

import { decodeEntityReadResponse } from "./ryotql";

const field = (kind: string, value: unknown) => ({ kind, value });

const entityResponse = (populatedAt: unknown) => ({
	data: {
		entities: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 1, page: 1, total: 1 },
			items: [
				{
					populatedAt,
					properties: field("json", {}),
					id: field("text", "entity-id"),
					name: field("text", "Example"),
					externalId: field("null", null),
					providerId: field("null", null),
					entitySchemaSlug: field("text", "anime"),
					createdAt: field("date", "2024-01-02T00:00:00.000Z"),
					updatedAt: field("date", "2024-01-03T00:00:00.000Z"),
				},
			],
		},
	},
});

describe("RyotQL media decoders", () => {
	it("preserves canonical dates for sandbox entity consumers", () => {
		const entity = decodeEntityReadResponse(
			entityResponse(field("date", "2024-01-04T00:00:00.000Z")),
		);

		expect(entity.createdAt).toBe("2024-01-02T00:00:00.000Z");
		expect(entity.populatedAt).toBe("2024-01-04T00:00:00.000Z");
		expect(entity.updatedAt).toBe("2024-01-03T00:00:00.000Z");
	});

	it("preserves null populated dates", () => {
		expect(decodeEntityReadResponse(entityResponse(field("null", null))).populatedAt).toBeNull();
	});
});
