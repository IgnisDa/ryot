import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { flatFixtureRecipes } from "../tests/client/flat-media/recipes";

const singleRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

const activityRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 60, hasMore: false, nextCursor: null });

const SUMMARY_RECIPE = flatFixtureRecipes.summaryRecipe({
	collectionLimit: 6,
	entityId: "media-1",
});

const OVERVIEW_RECIPE = flatFixtureRecipes.overviewRecipe({
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "media-1",
	recommendationLimit: 12,
});

const ACTIVITY_RECIPE = flatFixtureRecipes.activityRecipe({
	eventLimit: 60,
	entityId: "media-1",
	collectionEventLimit: 40,
});

const SUMMARY_ROW = {
	owned: null,
	genres: null,
	images: null,
	id: "media-1",
	publishYear: 1999,
	state: "complete",
	isInLibrary: true,
	description: null,
	publishDate: null,
	isMonitored: false,
	name: "Fight Club",
	providerName: "TMDB",
	providerRating: 86.5,
	schemaSlug: "fixture",
	progressPercent: null,
	populationStatus: "ready",
	translationStatus: "none",
	productionStatus: "Released",
	collections: { items: [], pageInfo: { limit: 6, hasMore: false } },
};

const fieldKeys = (fields: readonly object[]) =>
	fields.map((field) => ("key" in field ? field.key : null));

describe("media flat recipes", () => {
	it("selects the shared summary alongside the requested entity schema", () => {
		const summary = SUMMARY_RECIPE.document.queries["summary"];
		if (summary?.output.type !== "rows") {
			throw new Error("Expected a summary rows query");
		}

		expect(Object.keys(SUMMARY_RECIPE.document.queries)).toEqual(["requested", "summary"]);
		expect(summary.from).toMatchObject({ table: "entity", alias: "entity" });
		expect(fieldKeys(summary.output.fields)).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"owned",
			"providerName",
			"description",
			"publishDate",
			"publishYear",
			"genres",
			"images",
			"providerRating",
			"productionStatus",
			"isInLibrary",
			"isMonitored",
			"state",
			"progressPercent",
		]);
		expect(summary.output.include?.[0]).toMatchObject({ limit: 6, key: "collections" });
		expect(summary.where).toMatchObject({
			type: "and",
			predicates: [{ right: { type: "literal", value: "fixture" } }, {}],
		});
	});

	it("decodes a summary with its flat lifecycle state", () => {
		expect(
			SUMMARY_RECIPE.decode({
				data: {
					requested: singleRows([{ schemaSlug: "fixture" }]),
					summary: singleRows([{ ...SUMMARY_ROW, progressPercent: 42, state: "in_progress" }]),
				},
			}),
		).toMatchObject({
			success: {
				entitySchemaSlug: "fixture",
				summary: { id: "media-1", progressPercent: 42, state: "in_progress" },
			},
		});
	});

	it("rejects a summary whose lifecycle state is episodic", () => {
		expect(
			SUMMARY_RECIPE.decode({
				data: {
					requested: singleRows([{ schemaSlug: "fixture" }]),
					summary: singleRows([{ ...SUMMARY_ROW, state: "caught_up" }]),
				},
			})._tag,
		).toBe("Failure");
	});

	it("decodes an entity of another schema as an absent summary with its schema slug", () => {
		expect(
			SUMMARY_RECIPE.decode({
				data: { summary: singleRows([]), requested: singleRows([{ schemaSlug: "show" }]) },
			}),
		).toMatchObject({ success: { summary: null, entitySchemaSlug: "show" } });
	});

	it("reads credits and recommendations from the schema side of each relationship", () => {
		const { people, companies, recommendations } = OVERVIEW_RECIPE.document.queries;
		if (
			people?.output.type !== "rows" ||
			companies?.output.type !== "rows" ||
			recommendations?.output.type !== "rows"
		) {
			throw new Error("Expected the overview rows queries");
		}

		expect(people.where).toMatchObject({
			predicates: [{}, {}, { right: { type: "literal", value: "person-to-fixture" } }],
		});
		expect(companies.where).toMatchObject({
			predicates: [{}, {}, { right: { type: "literal", value: "company-to-fixture" } }],
		});
		expect(recommendations.where).toMatchObject({
			predicates: [{ right: { type: "literal", value: "fixture" } }, {}, {}],
		});
	});

	it("reaches the group from the group side of its membership relationship", () => {
		const group = OVERVIEW_RECIPE.document.queries["group"];
		if (group?.output.type !== "rows") {
			throw new Error("Expected a group rows query");
		}

		expect(group.from).toMatchObject({ table: "entity", alias: "fixtureGroup" });
		expect(group.joins?.[0]).toMatchObject({
			type: "inner",
			table: { alias: "fixtureGroupRelationship" },
			on: {
				right: { field: "id", tableAlias: "fixtureGroup" },
				left: { field: "sourceEntityId", tableAlias: "fixtureGroupRelationship" },
			},
		});
		expect(group.where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "fixture-group" } },
				{
					right: { type: "literal", value: "media-1" },
					left: { field: "targetEntityId", tableAlias: "fixtureGroupRelationship" },
				},
				{ right: { type: "literal", value: "fixture-group-to-fixture" } },
			],
		});
	});

	it("excludes the subject from its own group rail and orders the rest", () => {
		const group = OVERVIEW_RECIPE.document.queries["group"];
		if (group?.output.type !== "rows") {
			throw new Error("Expected a group rows query");
		}
		const members = group.output.include?.[0];
		if (members === undefined || !("fields" in members)) {
			throw new Error("Expected the group members include");
		}

		expect(members).toMatchObject({ limit: 20, key: "members" });
		expect(members.where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "fixture" } },
				{
					operator: "neq",
					right: { type: "literal", value: "media-1" },
					left: { field: "id", tableAlias: "groupMember" },
				},
				{},
				{},
			],
		});
		expect(members.orderBy[0]).toMatchObject({
			direction: "asc",
			expr: { type: "cast", target: "number", expr: { path: ["order"], type: "jsonPath" } },
		});
		expect(fieldKeys(members.fields)).toEqual([
			"id",
			"name",
			"images",
			"populationStatus",
			"translationStatus",
		]);
	});

	it("decodes an item with no group as an absent group", () => {
		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					group: singleRows([]),
					people: activityRows([]),
					companies: activityRows([]),
					recommendations: activityRows([]),
				},
			}),
		).toMatchObject({ success: { group: undefined } });
	});

	it("tracks the item's own progress events alongside the lifecycle beats", () => {
		const events = ACTIVITY_RECIPE.document.queries["events"];
		if (events?.output.type !== "rows" || events.where?.type !== "and") {
			throw new Error("Expected a filtered events query");
		}

		expect(events.output.pagination).toMatchObject({ limit: 60 });
		expect(events.where.predicates[1]).toMatchObject({
			type: "in",
			values: [
				{ value: "backlog" },
				{ value: "on_hold" },
				{ value: "dropped" },
				{ value: "complete" },
				{ value: "review" },
				{ value: "progress" },
			],
		});
	});

	it("sums the schema's measure over completions and counts completions it cannot measure", () => {
		const totals = ACTIVITY_RECIPE.document.queries["totals"];
		if (totals?.output.type !== "rows") {
			throw new Error("Expected a totals rows query");
		}
		const { fields } = totals.output;
		const fieldOf = (key: string) => fields.find((field) => "key" in field && field.key === key);
		const amount = fieldOf("consumedAmount");
		const unknown = fieldOf("unknownAmountCount");
		if (
			amount === undefined ||
			unknown === undefined ||
			!("expr" in amount) ||
			!("expr" in unknown)
		) {
			throw new Error("Expected the totals aggregates");
		}

		expect(amount.expr).toMatchObject({
			type: "aggregate",
			aggregation: {
				function: "sum",
				expr: {
					type: "conditional",
					whenTrue: { type: "cast", expr: { type: "jsonPath", path: ["timeSpent"] } },
					condition: { type: "isNotNull", expr: { field: "id", tableAlias: "mediaAmountEvent" } },
				},
			},
		});
		expect(unknown.expr).toMatchObject({ type: "aggregate", aggregation: { function: "count" } });
		expect(JSON.stringify(unknown.expr)).toContain("timeSpent");
	});

	it("merges item and collection events into one descending order", () => {
		expect(
			ACTIVITY_RECIPE.decode({
				data: {
					totals: activityRows([
						{ completionCount: 1, consumedAmount: 169, unknownAmountCount: 0 },
					]),
					collectionEvents: activityRows([
						{
							id: "collection-added",
							collectionName: "Watchlist",
							collectionId: "collection-1",
							createdAt: "2024-02-02T10:00:00.000Z",
							occurredAt: "2024-02-02T09:00:00.000Z",
							eventSchemaSlug: "add-entity-to-collection",
						},
					]),
					events: activityRows([
						{
							text: null,
							rating: null,
							timeSpent: null,
							isSpoiler: null,
							startedOn: null,
							completedOn: null,
							progressPercent: 42,
							id: "media-progress",
							consumedOn: "Jellyfin",
							eventSchemaSlug: "progress",
							createdAt: "2024-02-03T10:00:00.000Z",
							occurredAt: "2024-02-03T09:00:00.000Z",
						},
					]),
				},
			}),
		).toMatchObject({
			success: {
				truncated: false,
				completionCount: 1,
				consumedAmount: 169,
				unknownAmountCount: 0,
				events: [
					{ kind: "media", progressPercent: 42, id: "media-progress", consumedOn: "Jellyfin" },
					{ kind: "collection", progressPercent: null, id: "collection-added" },
				],
			},
		});
	});

	it("builds one presentation query for all requested IDs", () => {
		const recipe = flatFixtureRecipes.presentationRecipe(["media-2", "media-1"]);
		const presentation = recipe.document.queries["rows"];
		if (presentation?.output.type !== "rows" || presentation.where?.type !== "and") {
			throw new Error("Expected a filtered presentation rows query");
		}

		expect(Object.keys(recipe.document.queries)).toEqual(["rows"]);
		expect(presentation.where.predicates[1]).toMatchObject({
			type: "in",
			values: [{ value: "media-2" }, { value: "media-1" }],
		});
		expect(fieldKeys(presentation.output.fields)).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"state",
			"images",
			"progressPercent",
			"publishDate",
			"publishYear",
			"productionStatus",
		]);
	});
});
