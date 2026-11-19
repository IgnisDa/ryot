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

import { animeRecipes } from "./anime-recipes";

const ACTIVITY_RECIPE = bindRecipe(animeRecipes.activityRecipe({ reference: { kind: "self" } }), {
	entityId: "anime-1",
});
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
describe("media anime query recipes", () => {
	it("selects the episode count and airing schedule the anime schema declares", () => {
		const summary = keys(
			bindRecipe(animeRecipes.summaryRecipe({ reference: { kind: "self" } }), {
				entityId: "anime-1",
			}),
			"summary",
		);

		expect(summary.slice(-3)).toEqual(["progressPercent", "episodes", "airingSchedule"]);
		expect(animeRecipes.presentationSource.fields.map(({ key }) => key)).toContain("episodes");
	});

	it("carries the recorded position on every activity event", () => {
		expect(fieldExpr(ACTIVITY_RECIPE, "events", "position")).toMatchObject({
			type: "cast",
			target: "json",
			expr: { type: "jsonPath", path: ["position"] },
		});
	});

	it("sums ready canonical episodes and missing coverage, not the live episode count", () => {
		const event = table("event", "consumptionTotalsEvent");
		const entity = table("entity", "animeActivityEntity");
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
		expect(fieldExpr(ACTIVITY_RECIPE, "totals", "consumedAmount")).toEqual<unknown>(
			sum(
				event,
				add(
					coalesce(
						castNumber(jsonPath(projection, "contribution", "episodes", "recorded")),
						literal(0),
					),
					coalesce(
						castNumber(jsonPath(projection, "contribution", "episodes", "estimated")),
						literal(0),
					),
				),
				{ where: ready },
			),
		);
		expect(fieldExpr(ACTIVITY_RECIPE, "totals", "unknownAmountCount")).toEqual<unknown>(
			count(event, {
				where: and(
					ready,
					eq(
						castBoolean(jsonPath(projection, "contribution", "episodes", "missing")),
						literal(true),
					),
				),
			}),
		);
	});

	it("asks for no group because anime has none", () => {
		const overview = bindRecipe(animeRecipes.overviewRecipe({ reference: { kind: "self" } }), {
			entityId: "anime-1",
		});

		expect(Object.keys(overview.document.queries)).toEqual([
			"companies",
			"people",
			"recommendations",
		]);
	});
});
