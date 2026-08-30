import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { entityReadRecipe, eventReadRecipe } from "./sandbox";

const pageInfo = { limit: 100, hasMore: false, nextCursor: null };

describe("sandbox recipes", () => {
	it("prepares and decodes entity reads", () => {
		const recipe = entityReadRecipe({ entityIds: ["entity-1", "entity-2"] });
		const query = recipe.document.queries.entities;
		assert(query);
		expect(query.where).toMatchObject({ values: [{ value: "entity-1" }, { value: "entity-2" }] });
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						entities: {
							pageInfo,
							type: "rows",
							items: [
								{
									name: "Book",
									id: "entity-1",
									externalId: null,
									providerId: null,
									populatedAt: null,
									entitySchemaSlug: "book",
									properties: { pages: 320 },
									createdAt: "2026-01-01T00:00:00Z",
									updatedAt: "2026-01-02T00:00:00Z",
								},
							],
						},
					},
				}),
			),
		).toMatchObject({
			items: [
				{
					id: "entity-1",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-02T00:00:00.000Z",
				},
			],
		});
	});

	it("prepares event reads and rejects malformed entity cardinality", () => {
		const eventRecipe = eventReadRecipe({ entitySchemaSlug: "book", eventSchemaSlug: "progress" });
		const query = eventRecipe.document.queries.events;
		assert(query);
		expect(query.where).toMatchObject({ type: "and" });

		const entityRecipe = entityReadRecipe({ entityIds: ["entity-1"] });
		expect(
			Result.isFailure(
				entityRecipe.decode({ data: { entities: { items: [], type: "aggregate" } } }),
			),
		).toBe(true);
	});
});
