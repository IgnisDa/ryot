import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { latestCompletionSuggestionsRecipe, trendingLatestMediaRecipe } from "./discovery-recipes";

const mediaRow = (id: string) => ({
	id,
	images: null,
	name: `Media ${id}`,
	schemaSlug: "movie",
	populationStatus: "ready",
	translationStatus: "none",
});

const page = (items: readonly unknown[], limit: number) =>
	rowsResult(items, { limit, hasMore: false, nextCursor: null });

describe("latest completion suggestions recipe", () => {
	it("validates the document", () => {
		const recipe = latestCompletionSuggestionsRecipe({ limit: 20 });
		expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess)).toBeNull();
	});

	it("resolves the items against the same source the source query reads", () => {
		const { queries } = latestCompletionSuggestionsRecipe({ limit: 20 }).document;
		const sourceFirst = queries["source"]?.where;
		const itemsWhere = queries["items"]?.where;
		if (sourceFirst?.type !== "comparison" || itemsWhere?.type !== "and") {
			throw new Error("Expected the source comparison and the items predicates");
		}

		expect(itemsWhere.predicates).toContainEqual(
			expect.objectContaining({ type: "comparison", right: sourceFirst.right }),
		);
		expect(sourceFirst.right).toMatchObject({ type: "first" });
	});

	it("reports no source when nothing was completed", () => {
		const decoded = latestCompletionSuggestionsRecipe({ limit: 20 }).decode({
			data: { source: page([], 2), items: page([], 20) },
		});

		expect(Result.getOrThrow(decoded)).toEqual({ items: [], source: null });
	});

	it("returns the source beside its suggestions", () => {
		const decoded = latestCompletionSuggestionsRecipe({ limit: 20 }).decode({
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
		const recipe = trendingLatestMediaRecipe({
			limit: 20,
			after: "cursor",
			entitySchemaSlugs: ["movie", "show"],
		});
		expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess)).toBeNull();
	});

	it("keys the latest batch on each row's schema and interleaves by rank", () => {
		const query = trendingLatestMediaRecipe({ limit: 20, entitySchemaSlugs: ["movie", "show"] })
			.document.queries["trending"];
		if (query?.output.type !== "rows" || query.where?.type !== "and") {
			throw new Error("Expected the filtered trending rows query");
		}

		expect(query.where.predicates).toContainEqual(
			expect.objectContaining({
				right: expect.objectContaining({
					type: "aggregate",
					aggregation: { function: "maximum", expr: expect.anything() },
					query: expect.objectContaining({
						where: expect.objectContaining({
							predicates: expect.arrayContaining([
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
