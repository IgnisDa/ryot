import { describe, expect, it } from "vitest";

import {
	collectionMediaSuggestionsRecipe,
	podcastDetailRecipe,
	podcastsByLifecycleStateRecipe,
	showsByLifecycleStateRecipe,
	trendingMediaRecipe,
} from "./query-recipes";

describe("media query recipes", () => {
	it("builds podcast details with parent and episode lifecycle state", () => {
		const recipe = podcastDetailRecipe({ episodeLimit: 12, entityId: "podcast-id" });
		const podcast = recipe.document.queries["podcast"];
		if (podcast?.output.type !== "rows") {
			throw new Error("Expected podcast rows query");
		}
		const episodes = podcast.output.include?.[0];

		expect(podcast.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"state",
		]);
		expect(
			episodes && "fields" in episodes
				? episodes.fields.map((field) => ("key" in field ? field.key : null))
				: [],
		).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"state",
			"episodeNumber",
		]);
	});

	it("filters lifecycle state before paginating show results", () => {
		const recipe = showsByLifecycleStateRecipe({
			limit: 7,
			state: "caught_up",
			entityId: "show-id",
			after: "show-cursor",
		});
		const shows = recipe.document.queries["shows"];
		if (shows?.output.type !== "rows" || shows.where?.type !== "and") {
			throw new Error("Expected filtered show rows query");
		}
		const lifecyclePredicates = shows.where.predicates[1];

		expect(shows.output.pagination).toEqual({ after: "show-cursor", limit: 7 });
		expect(shows.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"state",
		]);
		expect(lifecyclePredicates).toMatchObject({
			type: "and",
			predicates: [
				{ right: { type: "literal", value: "show" }, type: "comparison" },
				{ right: { type: "literal", value: "caught_up" }, type: "comparison" },
			],
		});
	});

	it("filters lifecycle state before paginating podcast results", () => {
		const recipe = podcastsByLifecycleStateRecipe({
			limit: 9,
			state: "untracked",
			after: "podcast-cursor",
		});
		const podcasts = recipe.document.queries["podcasts"];
		if (podcasts?.output.type !== "rows" || podcasts.where?.type !== "and") {
			throw new Error("Expected filtered podcast rows query");
		}

		expect(podcasts.output.pagination).toEqual({ after: "podcast-cursor", limit: 9 });
		expect(podcasts.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"state",
		]);
		expect(podcasts.where.predicates[1]).toMatchObject({
			type: "comparison",
			right: { type: "literal", value: "untracked" },
		});
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
			"populationStatus",
			"translationStatus",
		]);
		expect(recommendations.output.measures[0]).toMatchObject({ key: "recommendingSourceCount" });
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
		expect(trending.output.pagination).toEqual({ limit: 20, after: "trending-cursor" });
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
								rank: 1,
								id: "book-1",
								name: "Book",
								schemaSlug: "book",
								populationStatus: "ready",
								translationStatus: "none",
								fetchedAt: "2024-01-02T00:00:00.000Z",
							},
						],
					},
				},
			}),
		).toMatchObject({ success: { items: [{ id: "book-1", rank: 1 }] } });
	});
});
