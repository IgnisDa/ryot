import { describe, expect, it } from "bun:test";

import type { RyotQLDocument as ImportedRyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
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
	type Recipe,
	sum,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { bindRecipe, rowsResult } from "@ryot-app/ryotql-recipes/test-utils";

import { audiobookRecipes } from "./audiobook-recipes";

const OVERVIEW_RECIPE = bindRecipe(
	audiobookRecipes.overviewRecipe({ reference: { kind: "self" } }),
	{ entityId: "audiobook-1" },
);
const singleRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });
const rowFields = (
	recipe: { document: ImportedRyotQLDocument; decode: Recipe<unknown, AppSchema>["decode"] },
	name: string,
) => {
	const query = recipe.document.queries[name];
	if (query?.output.type !== "rows") {
		throw new Error(`Expected the ${name} rows query`);
	}
	return query.output.fields;
};
const fieldExpr = (
	recipe: { document: ImportedRyotQLDocument; decode: Recipe<unknown, AppSchema>["decode"] },
	name: string,
	key: string,
) => {
	const field = rowFields(recipe, name).find((entry) => "key" in entry && entry.key === key);
	if (field === undefined || !("expr" in field)) {
		throw new Error(`Expected the ${key} field`);
	}
	return field.expr;
};
const keys = (
	recipe: { document: ImportedRyotQLDocument; decode: Recipe<unknown, AppSchema>["decode"] },
	name: string,
) => rowFields(recipe, name).map((field) => ("key" in field ? field.key : null));
describe("media audiobook query recipes", () => {
	it("selects the runtime the audiobook schema declares", () => {
		const summary = keys(
			bindRecipe(audiobookRecipes.summaryRecipe({ reference: { kind: "self" } }), {
				entityId: "audiobook-1",
			}),
			"summary",
		);

		expect(summary.slice(-2)).toEqual(["progressPercent", "runtime"]);
		expect(audiobookRecipes.presentationSource.fields.map(({ key }) => key)).toContain("runtime");
	});

	it("sums ready canonical minutes and missing coverage without reading the live runtime", () => {
		const activity = bindRecipe(audiobookRecipes.activityRecipe({ reference: { kind: "self" } }), {
			entityId: "audiobook-1",
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
		expect(fieldExpr(activity, "totals", "consumedAmount")).toEqual<unknown>(
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
		expect(fieldExpr(activity, "totals", "unknownAmountCount")).toEqual<unknown>(
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
