import { describe, expect, it } from "vitest";

import {
	collectionMediaSuggestionsRecipe,
	showDetailRecipe,
	trendingMediaRecipe,
} from "./query-recipes";

describe("media query recipes", () => {
	it("builds show details with caller-owned nested limits", () => {
		const recipe = showDetailRecipe({
			seasonLimit: 4,
			episodeLimit: 12,
			entityId: "show-id",
		});
		const show = recipe.document.queries["show"];
		if (show?.output.type !== "rows") {
			throw new Error("Expected show rows query");
		}
		const seasons = show.output.include?.[0];
		const episodes = seasons && "include" in seasons ? seasons.include?.[0] : undefined;

		expect(show.where).toMatchObject({ type: "and" });
		expect(seasons).toMatchObject({ key: "seasons", limit: 4 });
		expect(episodes).toMatchObject({ key: "episodes", limit: 12 });
	});

	it("uses identity fields for media recommendation groups", () => {
		const recipe = collectionMediaSuggestionsRecipe({
			entitySchemaSlug: "book",
			collectionId: "collection-id",
		});
		const recommendations = recipe.document.queries["recommendations"];
		if (recommendations?.output.type !== "aggregate") {
			throw new Error("Expected recommendations aggregate query");
		}

		expect(recommendations.output.groupBy?.map((field) => field.key)).toEqual([
			"id",
			"name",
			"schemaSlug",
		]);
		expect(recommendations.output.measures[0]).toMatchObject({
			key: "recommendingSourceCount",
		});
	});

	it("keeps trending timestamps as dates in fields and predicates", () => {
		const recipe = trendingMediaRecipe({
			after: "trending-cursor",
			entitySchemaSlug: "book",
			fetchedAt: "2024-01-02T00:00:00.000Z",
		});
		const trending = recipe.document.queries["trending"];
		if (trending?.output.type !== "rows") {
			throw new Error("Expected trending rows query");
		}
		expect(trending.output.pagination).toEqual({
			after: "trending-cursor",
			limit: 20,
		});
		const fetchedAt = trending.output.fields.find(
			(field) => "key" in field && field.key === "fetchedAt",
		);

		expect(fetchedAt).toMatchObject({ expr: { target: "date", type: "cast" } });
		const where = trending.where;
		if (where?.type !== "and") {
			throw new Error("Expected trending predicates");
		}
		const fetchedAtPredicate = where.predicates.at(-1);
		expect(fetchedAtPredicate).toMatchObject({
			left: { target: "date", type: "cast" },
			right: { target: "date", type: "cast" },
		});
	});

	it("decodes selected values without tagged field wrappers", () => {
		const recipe = trendingMediaRecipe({
			entitySchemaSlug: "book",
			fetchedAt: "2024-01-02T00:00:00.000Z",
		});
		expect(
			recipe.decode({
				data: {
					trending: {
						type: "rows",
						pageInfo: { hasMore: false, limit: 20, nextCursor: null },
						items: [
							{
								id: "book-1",
								name: "Book",
								rank: 1,
								schemaSlug: "book",
								fetchedAt: "2024-01-02T00:00:00.000Z",
							},
						],
					},
				},
			}),
		).toMatchObject({ success: { items: [{ id: "book-1", rank: 1 }] } });
	});
});
