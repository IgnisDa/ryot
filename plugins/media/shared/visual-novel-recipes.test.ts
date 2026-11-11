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
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { visualNovelRecipes } from "./visual-novel-recipes";

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
describe("media visual novel query recipes", () => {
	it("selects the length the visual novel schema declares", () => {
		const summary = keys(
			bindRecipe(visualNovelRecipes.summaryRecipe({ reference: { kind: "self" } }), {
				entityId: "visual-novel-1",
			}),
			"summary",
		);

		expect(summary.slice(-2)).toEqual(["progressPercent", "lengthMinutes"]);
		expect(visualNovelRecipes.presentationSource.fields.map(({ key }) => key)).toContain(
			"lengthMinutes",
		);
	});

	it("sums ready canonical minutes and missing coverage without reading the live length", () => {
		const activity = bindRecipe(
			visualNovelRecipes.activityRecipe({ reference: { kind: "self" } }),
			{ entityId: "visual-novel-1" },
		);
		const event = table("event", "consumptionTotalsEvent");
		const entity = table("entity", "visualNovelActivityEntity");
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

	it("asks for no group because visual novels have none", () => {
		const overview = bindRecipe(
			visualNovelRecipes.overviewRecipe({ reference: { kind: "self" } }),
			{ entityId: "visual-novel-1" },
		);
		expect(Object.keys(overview.document.queries)).toEqual([
			"companies",
			"people",
			"recommendations",
		]);
	});
});
