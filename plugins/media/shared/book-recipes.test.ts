import {
	add,
	and,
	castBoolean,
	castNumber,
	coalesce,
	column,
	count,
	eq,
	inArray,
	isNotNull,
	jsonPath,
	literal,
	type PreparedRecipe,
	sum,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { bookRecipes } from "./book-recipes";

const OVERVIEW_RECIPE = bookRecipes.overviewRecipe({
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "book-1",
	recommendationLimit: 12,
	reference: { kind: "self" },
});

const singleRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

const rowFields = (recipe: PreparedRecipe<unknown>, name: string) => {
	const query = recipe.document.queries[name];
	if (query?.output.type !== "rows") {
		throw new Error(`Expected the ${name} rows query`);
	}
	return query.output.fields;
};

const fieldExpr = (recipe: PreparedRecipe<unknown>, name: string, key: string) => {
	const field = rowFields(recipe, name).find((entry) => "key" in entry && entry.key === key);
	if (field === undefined || !("expr" in field)) {
		throw new Error(`Expected the ${key} field`);
	}
	return field.expr;
};

const keys = (recipe: PreparedRecipe<unknown>, name: string) =>
	rowFields(recipe, name).map((field) => ("key" in field ? field.key : null));

describe("media book query recipes", () => {
	it("selects the pages and compilation fields the book schema declares", () => {
		const summary = keys(
			bookRecipes.summaryRecipe({
				collectionLimit: 6,
				entityId: "book-1",
				reference: { kind: "self" },
			}),
			"summary",
		);

		expect(summary.slice(-3)).toEqual(["progressPercent", "pages", "isCompilation"]);
		expect(summary).not.toContain("watchProviders");
		expect(bookRecipes.presentationSource.fields.map(({ key }) => key)).toContain("pages");
	});

	it("reads ready canonical pages, missing coverage and completions without live page metadata", () => {
		const activity = bookRecipes.activityRecipe({
			eventLimit: 60,
			entityId: "book-1",
			collectionEventLimit: 60,
			reference: { kind: "self" },
		});

		const event = table("event", "consumptionTotalsEvent");
		const entity = table("entity", "bookActivityEntity");
		const projection = column(event, "projection");
		const scope = and(
			eq(column(event, "entityId"), column(entity, "id")),
			eq(column(event, "eventSchemaPluginId"), column(entity, "entitySchemaPluginId")),
			inArray(
				column(event, "eventSchemaSlug"),
				["progress", "complete", "item-complete", "dropped", "on_hold"].map(literal),
			),
		);
		const ready = and(
			scope,
			and(
				eq(coalesce(column(event, "projectionStatus"), literal("pending")), literal("ready")),
				isNotNull(projection),
				isNotNull(jsonPath(projection, "contribution")),
			),
		);

		expect(fieldExpr(activity, "totals", "consumedAmount")).toEqual(
			sum(
				event,
				add(
					coalesce(
						castNumber(jsonPath(projection, "contribution", "pages", "recorded")),
						literal(0),
					),
					coalesce(
						castNumber(jsonPath(projection, "contribution", "pages", "estimated")),
						literal(0),
					),
				),
				{ where: ready },
			),
		);
		expect(fieldExpr(activity, "totals", "unknownAmountCount")).toEqual(
			count(event, {
				where: and(
					ready,
					eq(castBoolean(jsonPath(projection, "contribution", "pages", "missing")), literal(true)),
				),
			}),
		);
		expect(fieldExpr(activity, "totals", "completionCount")).toEqual(
			coalesce(
				sum(event, castNumber(jsonPath(projection, "contribution", "titleCompletions")), {
					where: ready,
				}),
				literal(0),
			),
		);
	});

	it("reaches the series from the group side of book-group-to-book", () => {
		expect(OVERVIEW_RECIPE.document.queries["group"]?.where).toMatchObject({
			predicates: [
				{
					predicates: [
						{ right: { type: "literal", value: "book-group" } },
						{
							left: { field: "entitySchemaPluginId" },
							right: { type: "pluginId", reference: { kind: "self" } },
						},
					],
				},
				{},
				{
					predicates: [
						{ right: { type: "literal", value: "book-group-to-book" } },
						{
							left: { field: "relationshipSchemaPluginId" },
							right: { type: "pluginId", reference: { kind: "self" } },
						},
					],
				},
			],
		});
	});

	it("decodes the unlinked creators alongside the credits", () => {
		const overviewData = {
			group: singleRows([]),
			people: singleRows([]),
			companies: singleRows([]),
			recommendations: singleRows([]),
		};

		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					...overviewData,
					creators: singleRows([
						{
							unlinkedCreators: [
								{ role: "Author", name: "Ann Author" },
								{ name: "Pan Press", role: "Publisher" },
							],
						},
					]),
				},
			}),
		).toMatchObject({
			success: {
				creators: {
					unlinkedCreators: [
						{ role: "Author", name: "Ann Author" },
						{ name: "Pan Press", role: "Publisher" },
					],
				},
			},
		});
		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					...overviewData,
					creators: singleRows([{ unlinkedCreators: [{ name: "Nameless" }] }]),
				},
			})._tag,
		).toBe("Failure");
	});
});
