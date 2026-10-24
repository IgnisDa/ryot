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
	not,
	type PreparedRecipe,
	sum,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import { videoGameRecipes } from "./video-game-recipes";

const SUMMARY_RECIPE = videoGameRecipes.summaryRecipe({
	collectionLimit: 6,
	entityId: "video-game-1",
	reference: { kind: "self" },
});

const TOTALS = videoGameRecipes.activityRecipe({
	eventLimit: 60,
	entityId: "video-game-1",
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

const OVERVIEW_RECIPE = videoGameRecipes.overviewRecipe({
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	recommendationLimit: 12,
	entityId: "video-game-1",
	reference: { kind: "self" },
});

describe("media video game query recipes", () => {
	it("selects the game type, time to beat and platform releases the video game schema declares", () => {
		expect(keys(SUMMARY_RECIPE, "summary").slice(-4)).toEqual([
			"progressPercent",
			"timeToBeat",
			"gameType",
			"platformReleases",
		]);
	});

	it("reaches into the nested time to beat for the presentation row", () => {
		const presentation = videoGameRecipes.presentationSource;
		const field = presentation.fields.find(({ key }) => key === "timeToBeatNormally");

		expect(field).toBeDefined();
		expect(field?.expr).toMatchObject({
			type: "cast",
			target: "number",
			expr: { type: "jsonPath", path: ["timeToBeat", "normally"] },
		});
	});

	it("reads ready canonical minutes and missing coverage, never raw time or community estimates", () => {
		const event = table("event", "consumptionTotalsEvent");
		const entity = table("entity", "videoGameActivityEntity");
		const projection = column(event, "projection");
		const scope = and(
			eq(column(event, "entityId"), column(entity, "id")),
			eq(column(event, "eventSchemaPluginId"), column(entity, "entitySchemaPluginId")),
			inArray(
				column(event, "eventSchemaSlug"),
				["progress", "complete", "item-complete", "dropped", "on_hold"].map(literal),
			),
		);
		const readyProjection = and(
			eq(coalesce(column(event, "projectionStatus"), literal("pending")), literal("ready")),
			isNotNull(projection),
			isNotNull(jsonPath(projection, "contribution")),
		);
		const ready = and(scope, readyProjection);

		expect(fieldExpr(TOTALS, "totals", "consumedAmount")).toEqual(
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
		expect(fieldExpr(TOTALS, "totals", "unknownAmountCount")).toEqual(
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
		expect(fieldExpr(TOTALS, "totals", "consumptionPendingCount")).toEqual(
			count(event, { where: and(scope, not(readyProjection)) }),
		);
		expect(fieldExpr(TOTALS, "totals", "consumptionFailedCount")).toEqual(
			count(event, { where: and(scope, eq(column(event, "projectionStatus"), literal("failed"))) }),
		);
	});

	it("reads originals from the source side and derivatives from the target side", () => {
		const { originals, derivatives } = OVERVIEW_RECIPE.document.queries;
		if (originals?.output.type !== "rows" || derivatives?.output.type !== "rows") {
			throw new Error("Expected the originals and derivatives rows queries");
		}

		expect(originals.output.pagination).toMatchObject({ limit: 12 });
		expect(derivatives.output.pagination).toMatchObject({ limit: 60 });
		expect(originals.joins?.[0]).toMatchObject({
			on: { left: { field: "sourceEntityId", tableAlias: "videoGameRelationship" } },
		});
		expect(derivatives.joins?.[0]).toMatchObject({
			on: { left: { field: "targetEntityId", tableAlias: "videoGameRelationship" } },
		});
		for (const [query, anchor] of [
			[originals, "targetEntityId"],
			[derivatives, "sourceEntityId"],
		] as const) {
			expect(query.where).toMatchObject({
				predicates: [
					{
						predicates: [
							{ right: { type: "literal", value: "video-game" } },
							{
								left: { field: "entitySchemaPluginId" },
								right: { type: "pluginId", reference: { kind: "self" } },
							},
						],
					},
					{ left: { field: anchor }, right: { value: "video-game-1" } },
					{
						predicates: [
							{ right: { type: "literal", value: "video-game-to-video-game" } },
							{
								left: { field: "relationshipSchemaPluginId" },
								right: { type: "pluginId", reference: { kind: "self" } },
							},
						],
					},
				],
			});
		}
		expect(keys(OVERVIEW_RECIPE, "derivatives")).toContain("kind");
	});

	it("orders derivatives by kind priority before year and name", () => {
		const query = OVERVIEW_RECIPE.document.queries["derivatives"];
		if (query?.output.type !== "rows") {
			throw new Error("Expected the derivatives rows query");
		}
		const priority = JSON.stringify(query.output.orderBy[0]);

		expect(query.output.orderBy.map(({ direction }) => direction)).toEqual([
			"asc",
			"asc",
			"asc",
			"asc",
		]);
		expect(priority.indexOf('"Port"')).toBeGreaterThan(-1);
		expect(priority.indexOf('"Port"')).toBeLessThan(priority.indexOf('"DLC"'));
		expect(priority.indexOf('"DLC"')).toBeLessThan(priority.indexOf('"Mod"'));
		expect(JSON.stringify(query.output.orderBy[1])).toContain("publishYear");
		expect(JSON.stringify(query.output.orderBy[2])).toContain('"name"');
	});
});
