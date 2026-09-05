import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import {
	movieActivityRecipe,
	movieOverviewRecipe,
	moviePresentationRecipe,
	movieSummaryRecipe,
} from "./movie-recipes";

const movieRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

const activityRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 60, hasMore: false, nextCursor: null });

const SUMMARY_RECIPE = movieSummaryRecipe({ collectionLimit: 6, entityId: "movie-1" });

const OVERVIEW_RECIPE = movieOverviewRecipe({
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "movie-1",
	recommendationLimit: 12,
});

const ACTIVITY_RECIPE = movieActivityRecipe({
	eventLimit: 60,
	entityId: "movie-1",
	collectionEventLimit: 40,
});

const MOVIE_SUMMARY_ROW = {
	owned: null,
	runtime: 169,
	genres: null,
	images: null,
	id: "movie-1",
	publishYear: 1999,
	state: "complete",
	isInLibrary: true,
	description: null,
	publishDate: null,
	isMonitored: false,
	name: "Fight Club",
	schemaSlug: "movie",
	providerName: "TMDB",
	providerRating: 86.5,
	watchProviders: null,
	progressPercent: null,
	populationStatus: "ready",
	translationStatus: "none",
	productionStatus: "Released",
	collections: { items: [], pageInfo: { limit: 6, hasMore: false } },
};

const summaryField = (key: string) => {
	const movie = SUMMARY_RECIPE.document.queries["movie"];
	if (movie?.output.type !== "rows") {
		throw new Error("Expected a movie rows query");
	}
	const field = movie.output.fields.find((entry) => "key" in entry && entry.key === key);
	if (field === undefined) {
		throw new Error(`Expected the ${key} field`);
	}
	return field;
};

describe("media movie query recipes", () => {
	it("selects the movie summary alongside the requested entity schema", () => {
		const movie = SUMMARY_RECIPE.document.queries["movie"];
		const requested = SUMMARY_RECIPE.document.queries["requested"];
		if (movie?.output.type !== "rows" || requested?.output.type !== "rows") {
			throw new Error("Expected movie and requested rows queries");
		}

		expect(movie.from).toMatchObject({ table: "entity", alias: "entity" });
		expect(movie.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
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
			"watchProviders",
			"state",
			"progressPercent",
			"runtime",
		]);
		expect(movie.output.include?.[0]).toMatchObject({ limit: 6, key: "collections" });
		expect(movie.where).toMatchObject({
			type: "and",
			predicates: [{ right: { value: "movie", type: "literal" } }, {}],
		});
	});

	it("derives flat lifecycle state without any session-scoped predicate", () => {
		expect(JSON.stringify(summaryField("state"))).not.toContain("sessionEntityId");
		expect(JSON.stringify(summaryField("progressPercent"))).not.toContain("sessionEntityId");
	});

	it("reports the progress percent only after the entity's own latest completion", () => {
		const progress = summaryField("progressPercent");
		if (!("expr" in progress) || progress.expr.type !== "conditional") {
			throw new Error("Expected a boundary-gated progress percent");
		}
		const serialized = JSON.stringify(progress.expr.condition);

		expect(serialized).toContain("movieSummaryLifecycleBoundary");
		expect(serialized).toContain("movieSummaryLifecycleProgress");
		expect(progress.expr.whenFalse).toEqual({ value: null, type: "literal" });
	});

	it("decodes a movie summary with its runtime and flat lifecycle state", () => {
		expect(
			SUMMARY_RECIPE.decode({
				data: {
					requested: movieRows([{ schemaSlug: "movie" }]),
					movie: movieRows([{ ...MOVIE_SUMMARY_ROW, progressPercent: 42, state: "in_progress" }]),
				},
			}),
		).toMatchObject({
			success: {
				entitySchemaSlug: "movie",
				movie: { runtime: 169, id: "movie-1", progressPercent: 42, state: "in_progress" },
			},
		});
	});

	it("rejects a movie summary whose lifecycle state is episodic", () => {
		expect(
			SUMMARY_RECIPE.decode({
				data: {
					requested: movieRows([{ schemaSlug: "movie" }]),
					movie: movieRows([{ ...MOVIE_SUMMARY_ROW, state: "caught_up" }]),
				},
			})._tag,
		).toBe("Failure");
	});

	it("decodes a non-movie entity as an absent summary with its schema slug", () => {
		expect(
			SUMMARY_RECIPE.decode({
				data: { movie: movieRows([]), requested: movieRows([{ schemaSlug: "show" }]) },
			}),
		).toMatchObject({ success: { movie: null, entitySchemaSlug: "show" } });
	});

	it("reads credits and recommendations from the movie side of each relationship", () => {
		const people = OVERVIEW_RECIPE.document.queries["people"];
		const companies = OVERVIEW_RECIPE.document.queries["companies"];
		const recommendations = OVERVIEW_RECIPE.document.queries["recommendations"];
		if (
			people?.output.type !== "rows" ||
			companies?.output.type !== "rows" ||
			recommendations?.output.type !== "rows"
		) {
			throw new Error("Expected the overview rows queries");
		}

		expect(people.where).toMatchObject({
			predicates: [{}, {}, { right: { type: "literal", value: "person-to-movie" } }],
		});
		expect(companies.where).toMatchObject({
			predicates: [{}, {}, { right: { type: "literal", value: "company-to-movie" } }],
		});
		expect(recommendations.where).toMatchObject({
			predicates: [{ right: { value: "movie", type: "literal" } }, {}, {}],
		});
	});

	it("reaches the collection from the group side of movie-group-to-movie", () => {
		const group = OVERVIEW_RECIPE.document.queries["group"];
		if (group?.output.type !== "rows") {
			throw new Error("Expected a group rows query");
		}

		expect(group.from).toMatchObject({ table: "entity", alias: "movieGroup" });
		expect(group.joins?.[0]).toMatchObject({
			type: "inner",
			table: { alias: "movieGroupRelationship" },
			on: {
				right: { field: "id", tableAlias: "movieGroup" },
				left: { field: "sourceEntityId", tableAlias: "movieGroupRelationship" },
			},
		});
		expect(group.where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "movie-group" } },
				{
					right: { type: "literal", value: "movie-1" },
					left: { field: "targetEntityId", tableAlias: "movieGroupRelationship" },
				},
				{ right: { type: "literal", value: "movie-group-to-movie" } },
			],
		});
	});

	it("excludes the subject movie from its own collection rail and orders the rest", () => {
		const group = OVERVIEW_RECIPE.document.queries["group"];
		if (group?.output.type !== "rows") {
			throw new Error("Expected a group rows query");
		}
		const movies = group.output.include?.[0];
		if (movies === undefined || !("fields" in movies)) {
			throw new Error("Expected the group members include");
		}

		expect(movies).toMatchObject({ limit: 20, key: "members" });
		expect(movies.where).toMatchObject({
			predicates: [
				{ right: { value: "movie", type: "literal" } },
				{
					operator: "neq",
					right: { type: "literal", value: "movie-1" },
					left: { field: "id", tableAlias: "groupMember" },
				},
				{},
				{},
			],
		});
		expect(movies.orderBy[0]).toMatchObject({
			direction: "asc",
			expr: { type: "cast", target: "number", expr: { path: ["order"], type: "jsonPath" } },
		});
		expect(movies.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"images",
			"populationStatus",
			"translationStatus",
		]);
	});

	it("decodes a movie with no collection as an absent group", () => {
		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					group: movieRows([]),
					people: activityRows([]),
					companies: activityRows([]),
					recommendations: activityRows([]),
				},
			}),
		).toMatchObject({ success: { group: undefined } });
	});

	it("tracks the movie's own progress events, which shows keep on their episodes", () => {
		const movieEvents = ACTIVITY_RECIPE.document.queries["movieEvents"];
		if (movieEvents?.output.type !== "rows" || movieEvents.where?.type !== "and") {
			throw new Error("Expected a filtered movie events query");
		}

		expect(movieEvents.output.pagination).toMatchObject({ limit: 60 });
		expect(movieEvents.where.predicates[1]).toMatchObject({
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
		expect(movieEvents.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"createdAt",
			"occurredAt",
			"text",
			"rating",
			"timeSpent",
			"consumedOn",
			"isSpoiler",
			"startedOn",
			"completedOn",
			"progressPercent",
			"eventSchemaSlug",
		]);
	});

	it("aggregates watch minutes on the server with the movie runtime as the fallback", () => {
		const totals = ACTIVITY_RECIPE.document.queries["totals"];
		if (totals?.output.type !== "rows") {
			throw new Error("Expected a totals rows query");
		}

		expect(totals.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"completionCount",
			"consumedMinutes",
			"unknownDurationCount",
		]);
		const minutes = totals.output.fields[1];
		if (minutes === undefined || !("expr" in minutes)) {
			throw new Error("Expected the watched minutes aggregate");
		}
		expect(minutes.expr).toMatchObject({
			type: "aggregate",
			aggregation: { function: "sum", expr: { type: "coalesce" } },
		});
		expect(JSON.stringify(minutes.expr)).toContain("runtime");
	});

	it("merges movie and collection events into one descending order", () => {
		const decoded = ACTIVITY_RECIPE.decode({
			data: {
				totals: activityRows([
					{ completionCount: 1, consumedMinutes: 169, unknownDurationCount: 0 },
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
				movieEvents: activityRows([
					{
						text: null,
						rating: null,
						timeSpent: null,
						isSpoiler: null,
						startedOn: null,
						completedOn: null,
						progressPercent: 42,
						id: "movie-progress",
						consumedOn: "Jellyfin",
						eventSchemaSlug: "progress",
						createdAt: "2024-02-03T10:00:00.000Z",
						occurredAt: "2024-02-03T09:00:00.000Z",
					},
				]),
			},
		});

		expect(decoded).toMatchObject({
			success: {
				watchCount: 1,
				truncated: false,
				watchedMinutes: 169,
				watchedUnknownRuntime: 0,
				events: [
					{ kind: "media", progressPercent: 42, id: "movie-progress", consumedOn: "Jellyfin" },
					{ kind: "collection", progressPercent: null, id: "collection-added" },
				],
			},
		});
	});

	it("builds one presentation query for all requested movie IDs", () => {
		const recipe = moviePresentationRecipe(["movie-2", "movie-1"]);
		const movies = recipe.document.queries["movies"];
		if (movies?.output.type !== "rows" || movies.where?.type !== "and") {
			throw new Error("Expected a filtered presentation rows query");
		}

		expect(Object.keys(recipe.document.queries)).toEqual(["movies"]);
		expect(movies.where.predicates[1]).toMatchObject({
			type: "in",
			values: [{ value: "movie-2" }, { value: "movie-1" }],
		});
		expect(movies.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"state",
			"images",
			"runtime",
			"progressPercent",
			"publishDate",
			"publishYear",
			"productionStatus",
		]);
	});
});
