import { describe, expect, it } from "bun:test";

import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { bindRecipe, rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { anything, arrayContaining, objectContaining } from "@ryot-app/testing/matchers";

import {
	collectionRecommendationSourcesRecipe,
	collectionRecommendationsRecipe,
	latestCompletionSuggestionsRecipe,
	trendingLatestMediaRecipe,
} from "./discovery-recipes";

const mediaRow = (id: string) => ({
	id,
	images: null,
	name: `Media ${id}`,
	schemaSlug: "movie",
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
});

const page = (items: readonly unknown[], limit: number) =>
	rowsResult(items, { limit, hasMore: false, nextCursor: null });

describe("latest completion suggestions recipe", () => {
	it("validates the document", () => {
		const recipe = bindRecipe(
			latestCompletionSuggestionsRecipe({ reference: { kind: "self" } }),
			{},
			undefined,
			{ pages: { items: { limit: 20 } } },
		);
		expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess).error).toBeNull();
	});

	it("resolves the items against the same source the source query reads", () => {
		const { queries } = bindRecipe(
			latestCompletionSuggestionsRecipe({ reference: { kind: "self" } }),
			{},
			undefined,
			{ pages: { items: { limit: 20 } } },
		).document;
		const sourceFirst = queries["source"]?.where;
		const itemsWhere = queries["items"]?.where;
		if (sourceFirst?.type !== "comparison" || itemsWhere?.type !== "and") {
			throw new Error("Expected the source comparison and the items predicates");
		}

		expect(itemsWhere.predicates).toContainEqual<unknown>(
			objectContaining({ type: "comparison", right: sourceFirst.right }),
		);
		expect(sourceFirst.right).toMatchObject({ type: "first" });
	});

	it("reports no source when nothing was completed", () => {
		const decoded = bindRecipe(
			latestCompletionSuggestionsRecipe({ reference: { kind: "self" } }),
			{},
			undefined,
			{ pages: { items: { limit: 20 } } },
		).decode({ data: { source: page([], 2), items: page([], 20) } });
		expect(Result.getOrThrow(decoded)).toEqual({ items: [], source: null });
	});

	it("returns the source beside its suggestions", () => {
		const decoded = bindRecipe(
			latestCompletionSuggestionsRecipe({ reference: { kind: "self" } }),
			{},
			undefined,
			{ pages: { items: { limit: 20 } } },
		).decode({
			data: { source: page([mediaRow("source")], 2), items: page([mediaRow("target")], 20) },
		});

		expect(Result.getOrThrow(decoded)).toMatchObject({
			source: { id: "source" },
			items: [{ id: "target" }],
		});
	});
});

describe("trending latest media recipe", () => {
	it("validates the document", () => {
		const recipe = bindRecipe(trendingLatestMediaRecipe({ reference: { kind: "self" } }), {
			limit: 20,
			after: "cursor",
			entitySchemaSlugs: ["movie", "show"],
		});
		expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess).error).toBeNull();
	});

	it("keys the latest batch on each row's schema and interleaves by rank", () => {
		const query = bindRecipe(trendingLatestMediaRecipe({ reference: { kind: "self" } }), {
			limit: 20,
			entitySchemaSlugs: ["movie", "show"],
		}).document.queries["trending"];
		if (query?.output.type !== "rows" || query.where?.type !== "and") {
			throw new Error("Expected the filtered trending rows query");
		}

		expect(query.where.predicates).toContainEqual<unknown>(
			objectContaining({
				right: objectContaining({
					type: "aggregate",
					aggregation: { expr: anything(), function: "maximum" },
					query: objectContaining({
						where: objectContaining({
							predicates: arrayContaining([
								{
									operator: "eq",
									type: "comparison",
									right: {
										type: "column",
										field: "entitySchemaSlug",
										tableAlias: "trendingEntity",
									},
									left: {
										type: "column",
										field: "entitySchemaSlug",
										tableAlias: "latestTrendingEntity",
									},
								},
							]),
						}),
					}),
				}),
			}),
		);
		expect(query.output.orderBy.map(({ expr, direction }) => [direction, expr.type])).toEqual([
			["asc", "cast"],
			["asc", "column"],
			["asc", "column"],
		]);
	});
});

const recommendationsQuery = (searchText?: string) =>
	bindRecipe(collectionRecommendationsRecipe({ reference: { kind: "self" } }), {
		limit: 20,
		collectionId: "col",
		searchText: searchText?.trim(),
	}).document.queries["recommendations"];

const sources = (count: number) => ({ type: "aggregate", items: [{ count }] });

describe("collection recommendations recipes", () => {
	it("validates both documents", () => {
		for (const recipe of [
			bindRecipe(collectionRecommendationSourcesRecipe({ reference: { kind: "self" } }), {
				collectionId: "col",
			}),
			bindRecipe(collectionRecommendationsRecipe({ reference: { kind: "self" } }), {
				limit: 20,
				after: "cursor",
				searchText: "dune",
				collectionId: "col",
			}),
		]) {
			expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess).error).toBeNull();
		}
	});

	it("ranks by suggesting members before name and searches only when given text", () => {
		const query = recommendationsQuery("  dune ");
		if (query?.output.type !== "rows" || query.where?.type !== "and") {
			throw new Error("Expected the filtered recommendation rows query");
		}

		expect(query.output.orderBy.map(({ expr, direction }) => [direction, expr.type])).toEqual([
			["desc", "aggregate"],
			["asc", "column"],
			["asc", "column"],
		]);
		expect(query.where.predicates).toContainEqual<unknown>(
			objectContaining({ type: "contains", right: objectContaining({ value: "dune" }) }),
		);
		expect(recommendationsQuery("  ")?.where).toMatchObject({
			predicates: [
				anything(),
				anything(),
				anything(),
				anything(),
				{ type: "contains", right: { value: "", type: "literal" } },
			],
		});
	});

	it("reports a missing collection and counts suggesting members", () => {
		const recipe = bindRecipe(
			collectionRecommendationSourcesRecipe({ reference: { kind: "self" } }),
			{ collectionId: "col" },
		);
		expect(
			Result.getOrThrow(recipe.decode({ data: { sources: sources(0), collection: page([], 2) } })),
		).toBeNull();
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: { sources: sources(3), collection: page([{ id: "col", name: "Shelf" }], 2) },
				}),
			),
		).toMatchObject({ id: "col", name: "Shelf", sourceCount: 3 });
	});
});
