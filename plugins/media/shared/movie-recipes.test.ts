import {
	add,
	and,
	castBoolean,
	castNumber,
	coalesce,
	column,
	count,
	descending,
	eq,
	first,
	gt,
	inArray,
	isNotNull,
	isNull,
	jsonPath,
	literal,
	or,
	type PreparedRecipe,
	sum,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import { movieRecipes } from "./movie-recipes";

const SUMMARY_RECIPE = movieRecipes.summaryRecipe({
	collectionLimit: 6,
	entityId: "movie-1",
	reference: { kind: "self" },
});

const TOTALS = movieRecipes.activityRecipe({
	eventLimit: 60,
	entityId: "movie-1",
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

describe("media movie query recipes", () => {
	it("selects the watch providers and runtime the movie schema declares", () => {
		expect(keys(SUMMARY_RECIPE, "summary").slice(-3)).toEqual([
			"progressPercent",
			"watchProviders",
			"runtime",
		]);
		expect(movieRecipes.presentationSource.fields.map(({ key }) => key)).toContain("runtime");
	});

	it("derives flat lifecycle state without any session-scoped predicate", () => {
		expect(JSON.stringify(fieldExpr(SUMMARY_RECIPE, "summary", "state"))).not.toContain(
			"sessionEntityId",
		);
		expect(JSON.stringify(fieldExpr(SUMMARY_RECIPE, "summary", "progressPercent"))).not.toContain(
			"sessionEntityId",
		);
	});

	it("reports progress only after the entity's own latest completion or list-state boundary", () => {
		const progress = fieldExpr(SUMMARY_RECIPE, "summary", "progressPercent");
		if (progress.type !== "conditional" || progress.whenFalse.type !== "conditional") {
			throw new Error("Expected a boundary-gated progress percent");
		}
		const nativeProgress = progress.whenFalse;
		const entity = table("entity", "entity");
		const boundary = table("event", "movieSummaryLifecycleProgressBoundary");
		const latestProgress = table("event", "movieSummaryLifecycleProgress");
		const boundaryField = (field: string) =>
			first(boundary, {
				select: column(boundary, field),
				orderBy: [
					descending(column(boundary, "occurredAt")),
					descending(column(boundary, "orderCreatedAt")),
					descending(column(boundary, "orderKey")),
				],
				where: and(
					eq(column(boundary, "eventSchemaPluginId"), column(entity, "entitySchemaPluginId")),
					eq(column(boundary, "entityId"), column(entity, "id")),
					inArray(column(boundary, "eventSchemaSlug"), [
						literal("complete"),
						literal("list-state"),
					]),
				),
			});
		const progressField = (field: string) =>
			first(latestProgress, {
				select: column(latestProgress, field),
				orderBy: [
					descending(column(latestProgress, "occurredAt")),
					descending(column(latestProgress, "orderCreatedAt")),
					descending(column(latestProgress, "orderKey")),
				],
				where: and(
					eq(column(latestProgress, "eventSchemaPluginId"), column(entity, "entitySchemaPluginId")),
					eq(column(latestProgress, "entityId"), column(entity, "id")),
					eq(column(latestProgress, "eventSchemaSlug"), literal("progress")),
				),
			});

		expect(nativeProgress.condition).toEqual(
			or(
				isNull(boundaryField("orderKey")),
				gt(progressField("occurredAt"), boundaryField("occurredAt")),
				and(
					eq(progressField("occurredAt"), boundaryField("occurredAt")),
					or(
						gt(progressField("orderCreatedAt"), boundaryField("orderCreatedAt")),
						and(
							eq(progressField("orderCreatedAt"), boundaryField("orderCreatedAt")),
							gt(progressField("orderKey"), boundaryField("orderKey")),
						),
					),
				),
			),
		);
		expect(progress.whenTrue).toEqual({ value: null, type: "literal" });
		expect(nativeProgress.whenFalse).toEqual({ value: null, type: "literal" });
	});

	it("sums ready canonical minutes and missing coverage without reading the live runtime", () => {
		const event = table("event", "consumptionTotalsEvent");
		const entity = table("entity", "movieActivityEntity");
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
	});
});
