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

import { musicRecipes } from "./music-recipes";

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
describe("media music query recipes", () => {
	it("selects only the duration and various-artists fields the music schema declares", () => {
		const summary = keys(
			bindRecipe(musicRecipes.summaryRecipe({ reference: { kind: "self" } }), {
				entityId: "music-1",
			}),
			"summary",
		);

		expect(summary.slice(-3)).toEqual(["progressPercent", "duration", "byVariousArtists"]);
		expect(summary).not.toContain("watchProviders");
		expect(musicRecipes.presentationSource.fields.map(({ key }) => key)).toContain("duration");
	});

	it("sums ready canonical minutes and missing coverage without converting live duration again", () => {
		const activity = bindRecipe(musicRecipes.activityRecipe({ reference: { kind: "self" } }), {
			entityId: "music-1",
		});
		const event = table("event", "consumptionTotalsEvent");
		const entity = table("entity", "musicActivityEntity");
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
});
