import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { creatorFixtureRecipes, creatorPlainFixtureRecipes } from "../tests/client/creator/recipes";

const OVERVIEW_INPUT = { creditLimit: 12, entityId: "creator-1" };

const ACTIVITY_INPUT = { eventLimit: 60, entityId: "creator-1", collectionEventLimit: 40 };

const OVERVIEW_RECIPE = creatorFixtureRecipes.overviewRecipe(OVERVIEW_INPUT);

const ACTIVITY_RECIPE = creatorFixtureRecipes.activityRecipe(ACTIVITY_INPUT);

const rowsQuery = (recipe: PreparedRecipe<unknown>, name: string) => {
	const query = recipe.document.queries[name];
	if (query?.output.type !== "rows") {
		throw new Error(`Expected the ${name} rows query`);
	}
	return { ...query, output: query.output };
};

const keys = (recipe: PreparedRecipe<unknown>, name: string) =>
	rowsQuery(recipe, name).output.fields.map((field) => ("key" in field ? field.key : null));

const creditInclude = (recipe: PreparedRecipe<unknown>, slug: string) => {
	const include = rowsQuery(recipe, "credits").output.include?.find(({ key }) => key === slug);
	if (include === undefined) {
		throw new Error(`Expected the ${slug} credit include`);
	}
	return include;
};

const creditKeys = (recipe: PreparedRecipe<unknown>, slug: string) =>
	creditInclude(recipe, slug).fields.map((field) => ("key" in field ? field.key : null));

const activityRows = (items: readonly Record<string, unknown>[], hasMore = false) =>
	rowsResult(items, { hasMore, limit: 60, nextCursor: hasMore ? "cursor" : null });

const reviewRow = {
	rating: 80,
	text: "Great.",
	isSpoiler: false,
	id: "creator-review",
	createdAt: "2024-02-03T10:00:00.000Z",
	occurredAt: "2024-02-03T09:00:00.000Z",
};

const collectionRow = {
	id: "collection-added",
	collectionName: "Favourites",
	collectionId: "collection-1",
	createdAt: "2024-02-04T10:00:00.000Z",
	occurredAt: "2024-02-04T09:00:00.000Z",
	eventSchemaSlug: "add-entity-to-collection",
};

const decodeActivity = (input: { readonly hasMore: boolean }) =>
	ACTIVITY_RECIPE.decode({
		data: {
			totals: activityRows([{ reviewCount: 1 }]),
			collectionEvents: activityRows([collectionRow]),
			events: activityRows([reviewRow], input.hasMore),
		},
	});

describe("media creator recipes", () => {
	it("selects the entity summary and aliases without any publish, genre, rating or state field", () => {
		const recipe = creatorFixtureRecipes.summaryRecipe({
			collectionLimit: 6,
			entityId: "creator-1",
		});

		expect(Object.keys(recipe.document.queries)).toEqual(["requested", "summary"]);
		expect(keys(recipe, "summary")).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"providerName",
			"description",
			"images",
			"isInLibrary",
			"isMonitored",
			"alternateNames",
		]);
		expect(rowsQuery(recipe, "summary").where).toMatchObject({
			predicates: [{ right: { type: "literal", value: "creator" } }, {}],
		});
	});

	it("reads every credit target as an include correlated to the creator row", () => {
		const credits = rowsQuery(OVERVIEW_RECIPE, "credits");

		expect(Object.keys(OVERVIEW_RECIPE.document.queries)).toEqual(["credits"]);
		expect(credits.from).toMatchObject({ table: "entity", alias: "creatorCreditCreator" });
		expect(credits.where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "creator" } },
				{ right: { type: "literal", value: "creator-1" } },
			],
		});
		expect(credits.output.include?.map(({ key }) => key)).toEqual([
			"book",
			"comic-book",
			"anime",
			"movie",
			"show",
			"manga",
			"audiobook",
			"podcast",
			"video-game",
			"music",
			"visual-novel",
			"music-group",
			"video-game-group",
		]);
		const movie = creditInclude(OVERVIEW_RECIPE, "movie");

		expect(movie).toMatchObject({
			limit: 12,
			from: { table: "entity", alias: "creatorCredit3" },
			joins: [
				{
					type: "inner",
					on: {
						right: { field: "id", tableAlias: "creatorCredit3" },
						left: { field: "targetEntityId", tableAlias: "creatorCreditRelationship3" },
					},
				},
			],
			where: {
				predicates: [
					{ right: { value: "movie", type: "literal" } },
					{
						right: { field: "id", type: "column", tableAlias: "creatorCreditCreator" },
						left: { field: "sourceEntityId", tableAlias: "creatorCreditRelationship3" },
					},
					{ right: { type: "literal", value: "creator-to-movie" } },
				],
			},
		});
		expect(creditInclude(OVERVIEW_RECIPE, "music-group").where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "music-group" } },
				{},
				{ right: { type: "literal", value: "creator-to-music-group" } },
			],
		});
	});

	it("orders media credits newest first and group credits by name, never by year", () => {
		expect(creditInclude(OVERVIEW_RECIPE, "movie").orderBy).toMatchObject([
			{ direction: "desc", expr: { type: "cast", expr: { path: ["publishYear"] } } },
			{ direction: "asc", expr: { field: "name" } },
			{ direction: "asc", expr: { field: "id" } },
		]);
		const group = creditInclude(OVERVIEW_RECIPE, "video-game-group");
		expect(group.orderBy).toMatchObject([
			{ direction: "asc", expr: { field: "name" } },
			{ direction: "asc", expr: { field: "id" } },
		]);
		expect(JSON.stringify(group)).not.toContain("publishYear");
	});

	it("selects the character only when configured and only on media targets", () => {
		const creditFieldKeys = ["id", "name", "images", "order", "roles"];

		expect(creditKeys(OVERVIEW_RECIPE, "movie")).toEqual([
			...creditFieldKeys,
			"populationStatus",
			"translationStatus",
			"character",
		]);
		expect(creditKeys(OVERVIEW_RECIPE, "music-group")).not.toContain("character");
		expect(
			creditKeys(creatorPlainFixtureRecipes.overviewRecipe(OVERVIEW_INPUT), "movie"),
		).not.toContain("character");
	});

	it("decodes a missing creator as an empty page for every credit target", () => {
		const overview = OVERVIEW_RECIPE.decode({
			data: { credits: rowsResult([], { limit: 1, hasMore: false, nextCursor: null }) },
		});

		expect(overview).toMatchObject({
			success: {
				movie: { items: [], pageInfo: { hasMore: false } },
				"video-game-group": { items: [], pageInfo: { hasMore: false } },
			},
		});
	});

	it("counts and lists only review events", () => {
		const events = rowsQuery(ACTIVITY_RECIPE, "events");

		expect(events.where).toMatchObject({
			predicates: [{}, { type: "in", values: [{ value: "review" }] }],
		});
		expect(JSON.stringify(rowsQuery(ACTIVITY_RECIPE, "totals").output.fields)).toContain(
			'"value":"review"',
		);
		expect(keys(ACTIVITY_RECIPE, "events")).toEqual([
			"id",
			"createdAt",
			"occurredAt",
			"text",
			"rating",
			"isSpoiler",
		]);
	});

	it("merges reviews and collection events newest first", () => {
		expect(decodeActivity({ hasMore: false })).toMatchObject({
			success: {
				reviewCount: 1,
				truncated: false,
				events: [
					{ kind: "collection", id: "collection-added" },
					{ rating: 80, kind: "media", id: "creator-review" },
				],
			},
		});
	});

	it("reports the activity as truncated when a page has more events", () => {
		expect(decodeActivity({ hasMore: true })).toMatchObject({ success: { truncated: true } });
	});
});
