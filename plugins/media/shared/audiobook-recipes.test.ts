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

import { audiobookRecipes } from "./audiobook-recipes";

const OVERVIEW_RECIPE = audiobookRecipes.overviewRecipe({
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "audiobook-1",
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

describe("media audiobook query recipes", () => {
	it("selects the runtime the audiobook schema declares", () => {
		const summary = keys(
			audiobookRecipes.summaryRecipe({
				collectionLimit: 6,
				entityId: "audiobook-1",
				reference: { kind: "self" },
			}),
			"summary",
		);

		expect(summary.slice(-2)).toEqual(["progressPercent", "runtime"]);
		expect(audiobookRecipes.presentationSource.fields.map(({ key }) => key)).toContain("runtime");
	});

	it("sums ready canonical minutes and missing coverage without reading the live runtime", () => {
		const activity = audiobookRecipes.activityRecipe({
			eventLimit: 60,
			entityId: "audiobook-1",
			collectionEventLimit: 60,
			reference: { kind: "self" },
		});

		const event = table("event", "consumptionTotalsEvent");
		const entity = table("entity", "audiobookActivityEntity");
		const projection = column(event, "projection");
		const scope = and(
			eq(column(event, "entityId"), column(entity, "id")),
			eq(column(event, "eventSchemaPluginId"), column(entity, "entitySchemaPluginId")),
			inArray(
				column(event, "eventSchemaSlug"),
				["progress", "complete", "item-complete", "dropped", "on_hold"].map(literal),
			),
		);
		const ready = and(scope, isNotNull(jsonPath(projection, "contribution")));

		expect(fieldExpr(activity, "totals", "consumedAmount")).toEqual(
			sum(
				event,
				add(
					coalesce(
						castNumber(jsonPath(projection, "contribution", "minutes", "recorded")),
						literal(0),
					),
					coalesce(
						castNumber(jsonPath(projection, "contribution", "minutes", "estimated")),
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
					eq(
						castBoolean(jsonPath(projection, "contribution", "minutes", "missing")),
						literal(true),
					),
				),
			}),
		);
	});

	it("reaches the series from the group side of audiobook-group-to-audiobook", () => {
		expect(OVERVIEW_RECIPE.document.queries["group"]?.where).toMatchObject({
			predicates: [
				{
					predicates: [
						{ right: { type: "literal", value: "audiobook-group" } },
						{
							left: { field: "entitySchemaPluginId" },
							right: { type: "pluginId", reference: { kind: "self" } },
						},
					],
				},
				{},
				{
					predicates: [
						{ right: { type: "literal", value: "audiobook-group-to-audiobook" } },
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
		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					group: singleRows([]),
					people: singleRows([]),
					companies: singleRows([]),
					recommendations: singleRows([]),
					creators: singleRows([{ unlinkedCreators: [{ role: "Narrator", name: "Nia Voice" }] }]),
				},
			}),
		).toMatchObject({
			success: { creators: { unlinkedCreators: [{ role: "Narrator", name: "Nia Voice" }] } },
		});
	});
});
