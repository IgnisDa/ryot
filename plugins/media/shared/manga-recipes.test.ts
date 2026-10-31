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

import { mangaRecipes } from "./manga-recipes";

const ACTIVITY_RECIPE = mangaRecipes.activityRecipe({
	eventLimit: 60,
	entityId: "manga-1",
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

describe("media manga query recipes", () => {
	it("selects the chapter and volume counts the manga schema declares", () => {
		const summary = keys(
			mangaRecipes.summaryRecipe({
				collectionLimit: 6,
				entityId: "manga-1",
				reference: { kind: "self" },
			}),
			"summary",
		);

		expect(summary.slice(-3)).toEqual(["progressPercent", "volumes", "chapters"]);
		expect(mangaRecipes.presentationSource.fields.map(({ key }) => key)).toContain("chapters");
	});

	it("carries the recorded volume and chapter on every activity event", () => {
		expect(keys(ACTIVITY_RECIPE, "events").slice(-2)).toEqual(["mangaVolume", "mangaChapter"]);
		expect(fieldExpr(ACTIVITY_RECIPE, "events", "mangaChapter")).toMatchObject({
			type: "cast",
			target: "number",
			expr: { type: "jsonPath", path: ["mangaChapter"] },
		});
	});

	it("sums ready canonical chapters and missing coverage, not the live chapter count", () => {
		const event = table("event", "consumptionTotalsEvent");
		const entity = table("entity", "mangaActivityEntity");
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
						castNumber(jsonPath(projection, "contribution", "chapters", "recorded")),
						literal(0),
					),
					coalesce(
						castNumber(jsonPath(projection, "contribution", "chapters", "estimated")),
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
						castBoolean(jsonPath(projection, "contribution", "chapters", "missing")),
						literal(true),
					),
				),
			}),
		);
	});

	it("asks for no group because manga has none", () => {
		const overview = mangaRecipes.overviewRecipe({
			groupLimit: 20,
			peopleLimit: 12,
			companyLimit: 6,
			entityId: "manga-1",
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
