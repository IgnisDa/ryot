import { rowsResult } from "@ryot/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import {
	collectionMediaSuggestionsRecipe,
	podcastDetailRecipe,
	podcastsByLifecycleStateRecipe,
	showDetailRecipe,
	showsByLifecycleStateRecipe,
	showOverviewRecipe,
	showSummaryRecipe,
	trendingMediaRecipe,
} from "./query-recipes";

const showRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { hasMore: false, limit: 1, nextCursor: null });

const OVERVIEW_RECIPE = showOverviewRecipe({
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "show-1",
	recommendationLimit: 12,
});

const SHOW_SUMMARY_ROW = {
	owned: null,
	id: "show-1",
	totalSeasons: 1,
	totalEpisodes: 4,
	isInLibrary: true,
	isMonitored: true,
	publishYear: 2025,
	state: "complete",
	schemaSlug: "show",
	name: "Adolescence",
	providerName: "TMDB",
	providerRating: 78.25,
	productionStatus: "Ended",
	publishDate: "2025-03-13",
	genres: ["Drama", "Crime"],
	description: "A synopsis.",
	collections: {
		pageInfo: { hasMore: false, limit: 6 },
		items: [{ id: "collection-1", name: "Completed" }],
	},
	images: [
		{ type: "remote", url: "https://images.test/backdrop.jpg", purpose: "backdrop" },
		{ type: "remote", url: "https://images.test/cover.jpg", purpose: "cover" },
	],
};

describe("media query recipes", () => {
	it("builds show details with caller-owned nested limits", () => {
		const recipe = showDetailRecipe({ seasonLimit: 4, episodeLimit: 12, entityId: "show-id" });
		const show = recipe.document.queries["show"];
		if (show?.output.type !== "rows") {
			throw new Error("Expected show rows query");
		}
		const seasons = show.output.include?.[0];
		const episodes = seasons && "include" in seasons ? seasons.include?.[0] : undefined;

		expect(show.where).toMatchObject({ type: "and" });
		expect(show.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"state",
		]);
		expect(seasons).toMatchObject({ key: "seasons", limit: 4 });
		expect(episodes).toMatchObject({ key: "episodes", limit: 12 });
		expect(
			episodes && "fields" in episodes
				? episodes.fields.map((field) => ("key" in field ? field.key : null))
				: [],
		).toEqual(["id", "name", "schemaSlug", "state", "episodeNumber"]);
	});

	it("builds podcast details with parent and episode lifecycle state", () => {
		const recipe = podcastDetailRecipe({ episodeLimit: 12, entityId: "podcast-id" });
		const podcast = recipe.document.queries["podcast"];
		if (podcast?.output.type !== "rows") {
			throw new Error("Expected podcast rows query");
		}
		const episodes = podcast.output.include?.[0];

		expect(podcast.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"state",
		]);
		expect(
			episodes && "fields" in episodes
				? episodes.fields.map((field) => ("key" in field ? field.key : null))
				: [],
		).toEqual(["id", "name", "schemaSlug", "state", "episodeNumber"]);
	});

	it("filters lifecycle state before paginating show results", () => {
		const recipe = showsByLifecycleStateRecipe({
			limit: 7,
			state: "caught_up",
			entityId: "show-id",
			after: "show-cursor",
		});
		const shows = recipe.document.queries["shows"];
		if (shows?.output.type !== "rows" || shows.where?.type !== "and") {
			throw new Error("Expected filtered show rows query");
		}
		const lifecyclePredicates = shows.where.predicates[1];

		expect(shows.output.pagination).toEqual({ after: "show-cursor", limit: 7 });
		expect(shows.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"state",
		]);
		expect(lifecyclePredicates).toMatchObject({
			type: "and",
			predicates: [
				{ right: { type: "literal", value: "show" }, type: "comparison" },
				{ right: { type: "literal", value: "caught_up" }, type: "comparison" },
			],
		});
	});

	it("filters lifecycle state before paginating podcast results", () => {
		const recipe = podcastsByLifecycleStateRecipe({
			limit: 9,
			state: "untracked",
			after: "podcast-cursor",
		});
		const podcasts = recipe.document.queries["podcasts"];
		if (podcasts?.output.type !== "rows" || podcasts.where?.type !== "and") {
			throw new Error("Expected filtered podcast rows query");
		}

		expect(podcasts.output.pagination).toEqual({ after: "podcast-cursor", limit: 9 });
		expect(podcasts.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"state",
		]);
		expect(podcasts.where.predicates[1]).toMatchObject({
			type: "comparison",
			right: { type: "literal", value: "untracked" },
		});
	});

	it("uses identity fields for media recommendation groups", () => {
		const recipe = collectionMediaSuggestionsRecipe({
			entitySchemaSlug: "book",
			collectionId: "collection-id",
		});
		const recommendations = recipe.document.queries["recommendations"];
		if (recommendations?.output.type !== "aggregate") {
			throw new Error("Expected recommendations aggregate query");
		}

		expect(recommendations.output.groupBy?.map((field) => field.key)).toEqual([
			"id",
			"name",
			"schemaSlug",
		]);
		expect(recommendations.output.measures[0]).toMatchObject({
			key: "recommendingSourceCount",
		});
	});

	it("keeps trending timestamps as dates in fields and predicates", () => {
		const recipe = trendingMediaRecipe({
			after: "trending-cursor",
			entitySchemaSlug: "book",
			fetchedAt: "2024-01-02T00:00:00.000Z",
		});
		const trending = recipe.document.queries["trending"];
		if (trending?.output.type !== "rows") {
			throw new Error("Expected trending rows query");
		}
		expect(trending.output.pagination).toEqual({
			limit: 20,
			after: "trending-cursor",
		});
		const fetchedAt = trending.output.fields.find(
			(field) => "key" in field && field.key === "fetchedAt",
		);

		expect(fetchedAt).toMatchObject({ expr: { target: "date", type: "cast" } });
		const where = trending.where;
		if (where?.type !== "and") {
			throw new Error("Expected trending predicates");
		}
		const fetchedAtPredicate = where.predicates.at(-1);
		expect(fetchedAtPredicate).toMatchObject({
			left: { target: "date", type: "cast" },
			right: { target: "date", type: "cast" },
		});
	});

	it("decodes selected values without tagged field wrappers", () => {
		const recipe = trendingMediaRecipe({
			entitySchemaSlug: "book",
			fetchedAt: "2024-01-02T00:00:00.000Z",
		});
		expect(
			recipe.decode({
				data: {
					trending: {
						type: "rows",
						pageInfo: { hasMore: false, limit: 20, nextCursor: null },
						items: [
							{
								rank: 1,
								id: "book-1",
								name: "Book",
								schemaSlug: "book",
								fetchedAt: "2024-01-02T00:00:00.000Z",
							},
						],
					},
				},
			}),
		).toMatchObject({ success: { items: [{ id: "book-1", rank: 1 }] } });
	});

	it("selects the show summary alongside the requested entity schema", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "show-1" });
		const show = recipe.document.queries["show"];
		const requested = recipe.document.queries["requested"];
		if (show?.output.type !== "rows" || requested?.output.type !== "rows") {
			throw new Error("Expected show and requested rows queries");
		}

		expect(requested.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"schemaSlug",
		]);
		expect(show.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"state",
			"owned",
			"genres",
			"images",
			"providerName",
			"description",
			"publishDate",
			"productionStatus",
			"publishYear",
			"totalSeasons",
			"totalEpisodes",
			"providerRating",
			"isMonitored",
			"isInLibrary",
		]);
		expect(show.output.include?.[0]).toMatchObject({ key: "collections", limit: 6 });
		expect(show.joins?.[0]).toMatchObject({ type: "left", table: { alias: "provider" } });
	});

	it("decodes a show summary with collections and asset locators", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: { show: showRows([SHOW_SUMMARY_ROW]), requested: showRows([{ schemaSlug: "show" }]) },
			}),
		).toMatchObject({
			success: {
				entitySchemaSlug: "show",
				show: {
					owned: null,
					id: "show-1",
					state: "complete",
					publishYear: 2025,
					isInLibrary: true,
					isMonitored: true,
					providerName: "TMDB",
					genres: ["Drama", "Crime"],
					collections: { items: [{ id: "collection-1", name: "Completed" }] },
					images: [
						{ type: "remote", url: "https://images.test/backdrop.jpg", purpose: "backdrop" },
						{ type: "remote", url: "https://images.test/cover.jpg", purpose: "cover" },
					],
				},
			},
		});
	});

	it("decodes a missing show as an absent summary and absent schema", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "missing" });

		expect(recipe.decode({ data: { requested: showRows([]), show: showRows([]) } })).toMatchObject({
			success: { show: null, entitySchemaSlug: null },
		});
	});

	it("decodes a non-show entity as an absent summary with its schema slug", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "book-1" });

		expect(
			recipe.decode({
				data: { requested: showRows([{ schemaSlug: "book" }]), show: showRows([]) },
			}),
		).toMatchObject({ success: { show: null, entitySchemaSlug: "book" } });
	});

	it("decodes omitted optional show properties as null", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					show: showRows([
						{
							...SHOW_SUMMARY_ROW,
							genres: null,
							images: null,
							publishYear: null,
							description: null,
							publishDate: null,
							providerName: null,
							totalSeasons: null,
							totalEpisodes: null,
							providerRating: null,
							productionStatus: null,
						},
					]),
				},
			}),
		).toMatchObject({
			success: { show: { genres: null, images: null, publishYear: null, providerName: null } },
		});
	});

	it("rejects a show summary whose lifecycle state is not a media state", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					show: showRows([{ ...SHOW_SUMMARY_ROW, state: "watching" }]),
				},
			})._tag,
		).toBe("Failure");
	});

	it("rejects a show summary whose image locators are malformed", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					show: showRows([{ ...SHOW_SUMMARY_ROW, images: [{ type: "ftp", url: 12 }] }]),
				},
			})._tag,
		).toBe("Failure");
	});

	it("rejects a show summary whose image purpose is outside the media contract", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					show: showRows([
						{
							...SHOW_SUMMARY_ROW,
							images: [{ type: "remote", url: "https://images.test/a.jpg", purpose: "poster" }],
						},
					]),
				},
			})._tag,
		).toBe("Failure");
	});

	it("decodes images without a recorded purpose", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					show: showRows([{ ...SHOW_SUMMARY_ROW, images: [{ type: "s3", key: "legacy-image" }] }]),
				},
			}),
		).toMatchObject({ success: { show: { images: [{ type: "s3", key: "legacy-image" }] } } });
	});
	it("reads show credits from the relationship side that points at the show", () => {
		const recipe = showOverviewRecipe({
			peopleLimit: 12,
			companyLimit: 6,
			entityId: "show-1",
			recommendationLimit: 12,
		});
		const people = recipe.document.queries["people"];
		const companies = recipe.document.queries["companies"];
		if (people?.output.type !== "rows" || companies?.output.type !== "rows") {
			throw new Error("Expected people and companies rows queries");
		}

		expect(people.from).toMatchObject({ table: "relationship", alias: "personRelationship" });
		expect(people.joins?.[0]).toMatchObject({
			type: "inner",
			table: { alias: "person" },
			on: {
				right: { field: "id", tableAlias: "person" },
				left: { field: "sourceEntityId", tableAlias: "personRelationship" },
			},
		});
		expect(people.where).toMatchObject({
			type: "and",
			predicates: [
				{ right: { type: "literal", value: "person" } },
				{
					right: { type: "literal", value: "show-1" },
					left: { field: "targetEntityId", tableAlias: "personRelationship" },
				},
				{ right: { type: "literal", value: "person-to-show" } },
			],
		});
		expect(companies.where).toMatchObject({
			type: "and",
			predicates: [
				{ right: { type: "literal", value: "company" } },
				{
					right: { type: "literal", value: "show-1" },
					left: { field: "targetEntityId", tableAlias: "companyRelationship" },
				},
				{ right: { type: "literal", value: "company-to-show" } },
			],
		});
		expect(people.output.pagination).toMatchObject({ limit: 12 });
		expect(companies.output.pagination).toMatchObject({ limit: 6 });
		expect(people.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"images",
			"order",
			"roles",
			"character",
		]);
		expect(companies.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"images",
			"order",
			"roles",
		]);
	});

	it("orders credits by relationship order before a stable name tiebreaker", () => {
		const recipe = showOverviewRecipe({
			peopleLimit: 12,
			companyLimit: 6,
			entityId: "show-1",
			recommendationLimit: 12,
		});
		const people = recipe.document.queries["people"];
		if (people?.output.type !== "rows") {
			throw new Error("Expected people rows query");
		}

		expect(people.output.orderBy).toMatchObject([
			{
				direction: "asc",
				expr: { target: "number", type: "cast", expr: { path: ["order"], type: "jsonPath" } },
			},
			{ direction: "asc", expr: { field: "name", tableAlias: "person" } },
		]);
	});

	it("reads recommendations from the outgoing suggestion side of the show", () => {
		const recipe = showOverviewRecipe({
			peopleLimit: 12,
			companyLimit: 6,
			entityId: "show-1",
			recommendationLimit: 8,
		});
		const recommendations = recipe.document.queries["recommendations"];
		if (recommendations?.output.type !== "rows") {
			throw new Error("Expected recommendations rows query");
		}

		expect(recommendations.output.pagination).toMatchObject({ limit: 8 });
		expect(recommendations.where).toMatchObject({
			type: "and",
			predicates: [
				{ right: { type: "literal", value: "show" } },
				{
					right: { type: "literal", value: "show-1" },
					left: { field: "sourceEntityId", tableAlias: "suggestionRelationship" },
				},
				{ right: { type: "literal", value: "media-suggestion" } },
			],
		});
		expect(recommendations.output.orderBy).toMatchObject([
			{ direction: "asc", expr: { field: "name", tableAlias: "suggested" } },
		]);
		expect(
			recommendations.output.fields.map((field) => ("key" in field ? field.key : null)),
		).toEqual(["id", "name", "images"]);
	});

	it("decodes show credits, companies and recommendations with their locators", () => {
		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					people: showRows([
						{
							order: 1,
							id: "person-1",
							roles: ["Creator"],
							name: "Jack Thorne",
							character: "Narrator",
							images: [{ type: "remote", url: "https://images.test/jack.jpg", purpose: "profile" }],
						},
					]),
					companies: showRows([
						{
							order: 1,
							id: "company-1",
							name: "Warp Films",
							roles: ["Production Company"],
							images: [{ type: "s3", key: "warp-logo", purpose: "logo" }],
						},
					]),
					recommendations: showRows([
						{
							id: "show-2",
							name: "Bad Girls",
							images: [{ type: "local", key: "bad-girls-cover", purpose: "cover" }],
						},
					]),
				},
			}),
		).toMatchObject({
			success: {
				people: {
					items: [
						{
							order: 1,
							id: "person-1",
							roles: ["Creator"],
							name: "Jack Thorne",
							character: "Narrator",
							images: [{ type: "remote", url: "https://images.test/jack.jpg", purpose: "profile" }],
						},
					],
				},
				companies: {
					items: [
						{
							order: 1,
							id: "company-1",
							name: "Warp Films",
							roles: ["Production Company"],
							images: [{ type: "s3", key: "warp-logo", purpose: "logo" }],
						},
					],
				},
				recommendations: {
					items: [
						{
							id: "show-2",
							name: "Bad Girls",
							images: [{ type: "local", key: "bad-girls-cover", purpose: "cover" }],
						},
					],
				},
			},
		});
	});

	it("decodes credits that omit order, roles, character and images", () => {
		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					companies: showRows([]),
					recommendations: showRows([{ id: "show-2", name: "Bad Girls", images: null }]),
					people: showRows([
						{
							order: null,
							roles: null,
							images: null,
							id: "person-1",
							character: null,
							name: "Jo Johnson",
						},
					]),
				},
			}),
		).toMatchObject({
			success: {
				recommendations: { items: [{ images: null }] },
				people: {
					items: [{ order: null, roles: null, images: null, character: null, name: "Jo Johnson" }],
				},
			},
		});
	});

	it("decodes an entity with no credits or recommendations as empty sections", () => {
		expect(
			OVERVIEW_RECIPE.decode({
				data: { people: showRows([]), companies: showRows([]), recommendations: showRows([]) },
			}),
		).toMatchObject({
			success: { people: { items: [] }, companies: { items: [] }, recommendations: { items: [] } },
		});
	});

	it("rejects show credits whose image locators are malformed", () => {
		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					companies: showRows([]),
					recommendations: showRows([]),
					people: showRows([
						{
							order: 1,
							roles: null,
							id: "person-1",
							character: null,
							name: "Jack Thorne",
							images: [{ type: "ftp", url: 12 }],
						},
					]),
				},
			})._tag,
		).toBe("Failure");
	});
});
