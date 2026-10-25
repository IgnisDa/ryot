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
import { describe, expect, it } from "vitest";

import { animeRecipes } from "./anime-recipes";

const ACTIVITY_RECIPE = animeRecipes.activityRecipe({
	eventLimit: 60,
	entityId: "anime-1",
	collectionEventLimit: 60,
	reference: { kind: "self" },
});

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

describe("media anime query recipes", () => {
	it("selects the episode count and airing schedule the anime schema declares", () => {
		const summary = keys(
			animeRecipes.summaryRecipe({
				collectionLimit: 6,
				entityId: "anime-1",
				reference: { kind: "self" },
			}),
			"summary",
		);

		expect(summary.slice(-3)).toEqual(["progressPercent", "episodes", "airingSchedule"]);
		expect(animeRecipes.presentationSource.fields.map(({ key }) => key)).toContain("episodes");
	});

	it("carries the recorded episode on every activity event", () => {
		expect(keys(ACTIVITY_RECIPE, "events").at(-1)).toBe("animeEpisode");
		expect(fieldExpr(ACTIVITY_RECIPE, "events", "animeEpisode")).toMatchObject({
			type: "cast",
			target: "number",
			expr: { type: "jsonPath", path: ["animeEpisode"] },
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

		expect(fieldExpr(ACTIVITY_RECIPE, "totals", "consumedAmount")).toEqual(
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
		expect(fieldExpr(ACTIVITY_RECIPE, "totals", "unknownAmountCount")).toEqual(
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
		const overview = animeRecipes.overviewRecipe({
			groupLimit: 20,
			peopleLimit: 12,
			companyLimit: 6,
			entityId: "anime-1",
			recommendationLimit: 12,
			reference: { kind: "self" },
		});

		expect(Object.keys(overview.document.queries)).toEqual([
			"companies",
			"people",
			"recommendations",
		]);
	});
});
