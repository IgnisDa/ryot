import { table } from "@ryot-app/plugin-kit/ryotql";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import {
	flatFixtureRecipes,
	flatUngroupedFixtureRecipes,
} from "../tests/client/flat-media/recipes";
import { propertyNumber } from "./entity-selections";
import {
	mediaEntityCountMeasure,
	mediaReviewActivityRecipe,
	mediaTimeSpentMeasure,
} from "./media-recipes";

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
	description: null,
	publishDate: null,
	isMonitored: false,
	name: "Fight Club",
	providerName: "TMDB",
	providerRating: 86.5,
	schemaSlug: "fixture",
	progressPercent: null,
	isInMediaLibrary: true,
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
			"providerName",
			"description",
			"images",
			"isMonitored",
			"isInMediaLibrary",
			"owned",
			"publishDate",
			"publishYear",
			"genres",
			"providerRating",
			"productionStatus",
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

		expect(people.joins?.[0]).toMatchObject({
			on: {
				right: { field: "id", tableAlias: "person" },
				left: { field: "sourceEntityId", tableAlias: "personRelationship" },
			},
		});
		expect(people.where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "person" } },
				{
					right: { type: "literal", value: "media-1" },
					left: { field: "targetEntityId", tableAlias: "personRelationship" },
				},
				{ right: { type: "literal", value: "person-to-fixture" } },
			],
		});
		expect(companies.where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "company" } },
				{ left: { field: "targetEntityId", tableAlias: "companyRelationship" } },
				{ right: { type: "literal", value: "company-to-fixture" } },
			],
		});
		expect(recommendations.joins?.[0]).toMatchObject({
			on: {
				right: { field: "id", tableAlias: "suggested" },
				left: { field: "targetEntityId", tableAlias: "suggestionRelationship" },
			},
		});
		expect(recommendations.where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "fixture" } },
				{
					right: { type: "literal", value: "media-1" },
					left: { field: "sourceEntityId", tableAlias: "suggestionRelationship" },
				},
				{ right: { type: "literal", value: "media-suggestion" } },
			],
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
					creators: singleRows([]),
					people: activityRows([]),
					companies: activityRows([]),
					recommendations: activityRows([]),
				},
			}),
		).toMatchObject({ success: { group: undefined } });
	});

	it("omits the group query entirely for a schema that declares no group", () => {
		const overview = flatUngroupedFixtureRecipes.overviewRecipe({
			groupLimit: 20,
			peopleLimit: 12,
			companyLimit: 6,
			entityId: "media-1",
			recommendationLimit: 12,
		});

		expect(Object.keys(overview.document.queries)).toEqual([
			"companies",
			"people",
			"recommendations",
		]);
	});

	it("appends the schema's own activity event fields to the shared event selection", () => {
		const activity = flatUngroupedFixtureRecipes.activityRecipe({
			eventLimit: 60,
			entityId: "media-1",
			collectionEventLimit: 40,
		});
		const events = activity.document.queries["events"];
		if (events?.output.type !== "rows") {
			throw new Error("Expected an events rows query");
		}

		expect(fieldKeys(events.output.fields)).toEqual([
			"id",
			"createdAt",
			"occurredAt",
			"text",
			"rating",
			"isSpoiler",
			"timeSpent",
			"consumedOn",
			"startedOn",
			"completedOn",
			"progressPercent",
			"eventSchemaSlug",
			"fixtureChapter",
		]);
		expect(
			activity.decode({
				data: {
					collectionEvents: activityRows([]),
					totals: activityRows([
						{ completionCount: 0, consumedAmount: null, unknownAmountCount: 0 },
					]),
					events: activityRows([
						{
							text: null,
							rating: null,
							timeSpent: null,
							isSpoiler: null,
							startedOn: null,
							consumedOn: null,
							completedOn: null,
							fixtureChapter: 45,
							progressPercent: 62,
							id: "media-progress",
							eventSchemaSlug: "progress",
							createdAt: "2024-02-03T10:00:00.000Z",
							occurredAt: "2024-02-03T09:00:00.000Z",
						},
					]),
				},
			}),
		).toMatchObject({
			success: { events: [{ kind: "media", fixtureChapter: 45, id: "media-progress" }] },
		});
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
				{ value: "add-to-media-library" },
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

const MEASURE_EVENT = table("event", "measureEvent");

const MEASURE_ENTITY = table("entity", "measureEntity");

const propertyRead = (tableAlias: string, property: string) => ({
	type: "cast",
	target: "number",
	expr: { type: "jsonPath", path: [property], expr: { tableAlias, field: "properties" } },
});

describe("media flat measures", () => {
	it("measures only the event's time spent when no fallback is given", () => {
		const timeSpent = propertyRead("measureEvent", "timeSpent");

		expect(mediaTimeSpentMeasure()(MEASURE_EVENT, MEASURE_ENTITY)).toMatchObject({
			amount: timeSpent,
			isUnknown: { type: "isNull", expr: timeSpent },
		});
	});

	it("falls back to the entity amount and is unknown only when both are missing", () => {
		const timeSpent = propertyRead("measureEvent", "timeSpent");
		const runtime = propertyRead("measureEntity", "runtime");

		expect(
			mediaTimeSpentMeasure((entity) => propertyNumber(entity, "runtime"))(
				MEASURE_EVENT,
				MEASURE_ENTITY,
			),
		).toMatchObject({
			amount: { type: "coalesce", values: [timeSpent, runtime] },
			isUnknown: {
				type: "and",
				predicates: [
					{ type: "isNull", expr: timeSpent },
					{ expr: runtime, type: "isNull" },
				],
			},
		});
	});

	it("counts the named entity property", () => {
		const pages = propertyRead("measureEntity", "pages");

		expect(mediaEntityCountMeasure("pages")(MEASURE_EVENT, MEASURE_ENTITY)).toMatchObject({
			amount: pages,
			isUnknown: { expr: pages, type: "isNull" },
		});
	});
});

const REVIEW_ACTIVITY_RECIPE = mediaReviewActivityRecipe({ slug: "reviewed", alias: "reviewed" })({
	eventLimit: 60,
	entityId: "reviewed-1",
	collectionEventLimit: 40,
});

const reviewActivityRows = (items: readonly Record<string, unknown>[], hasMore = false) =>
	rowsResult(items, { hasMore, limit: 60, nextCursor: hasMore ? "cursor" : null });

const decodeReviewActivity = (input: { readonly hasMore: boolean }) =>
	REVIEW_ACTIVITY_RECIPE.decode({
		data: {
			totals: reviewActivityRows([{ reviewCount: 1 }]),
			events: reviewActivityRows(
				[
					{
						rating: 80,
						text: "Great.",
						isSpoiler: false,
						id: "entity-review",
						eventSchemaSlug: "review",
						createdAt: "2024-02-03T10:00:00.000Z",
						occurredAt: "2024-02-03T09:00:00.000Z",
					},
				],
				input.hasMore,
			),
			collectionEvents: reviewActivityRows([
				{
					id: "collection-added",
					collectionName: "Favourites",
					collectionId: "collection-1",
					createdAt: "2024-02-04T10:00:00.000Z",
					occurredAt: "2024-02-04T09:00:00.000Z",
					eventSchemaSlug: "add-entity-to-collection",
				},
			]),
		},
	});

describe("media review activity recipe", () => {
	it("counts and lists only review events", () => {
		const events = REVIEW_ACTIVITY_RECIPE.document.queries["events"];
		const totals = REVIEW_ACTIVITY_RECIPE.document.queries["totals"];
		if (events?.output.type !== "rows" || totals?.output.type !== "rows") {
			throw new Error("Expected the events and totals rows queries");
		}

		expect(events.where).toMatchObject({
			predicates: [
				{},
				{ type: "in", values: [{ value: "review" }, { value: "add-to-media-library" }] },
			],
		});
		expect(JSON.stringify(totals.output.fields)).toContain('"value":"review"');
		expect(fieldKeys(events.output.fields)).toEqual([
			"id",
			"createdAt",
			"occurredAt",
			"text",
			"rating",
			"isSpoiler",
			"eventSchemaSlug",
		]);
	});

	it("merges reviews and collection events newest first", () => {
		expect(decodeReviewActivity({ hasMore: false })).toMatchObject({
			success: {
				reviewCount: 1,
				truncated: false,
				events: [
					{ kind: "collection", id: "collection-added" },
					{ rating: 80, kind: "media", id: "entity-review" },
				],
			},
		});
	});

	it("reports the activity as truncated when a page has more events", () => {
		expect(decodeReviewActivity({ hasMore: true })).toMatchObject({ success: { truncated: true } });
	});
});
