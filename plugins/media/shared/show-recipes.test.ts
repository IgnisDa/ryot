import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import {
	showActivityRecipe,
	showOverviewRecipe,
	showPresentationRecipe,
	showSeasonEpisodesRecipe,
	showSeasonsRecipe,
	showSummaryRecipe,
} from "./show-recipes";

const showRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

const ACTIVITY_RECIPE = showActivityRecipe({
	timeZone: "UTC",
	seasonLimit: 50,
	watchDayLimit: 500,
	entityId: "show-1",
	parentEventLimit: 60,
	episodeEventLimit: 100,
	collectionEventLimit: 40,
	episodeProgressLimit: 100,
});

const activityRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 100, hasMore: false, nextCursor: null });

const progressRows = (items: readonly Record<string, unknown>[]) =>
	activityRows(
		items.map(({ id, createdAt, occurredAt, consumedOn, progressPercent, ...episode }) => ({
			...episode,
			milestone: {
				pageInfo: { limit: 1, hasMore: false },
				items: [{ id, createdAt, occurredAt, consumedOn, progressPercent }],
			},
		})),
	);

const PARENT_EVENT_ROW = {
	text: null,
	rating: null,
	timeSpent: null,
	isSpoiler: null,
	startedOn: null,
	consumedOn: null,
	completedOn: null,
	id: "parent-complete",
	eventSchemaSlug: "complete",
	createdAt: "2024-02-02T10:00:00.000Z",
	occurredAt: "2024-02-02T09:00:00.000Z",
};

const EPISODE_EVENT_ROW = {
	text: null,
	rating: null,
	seasonNumber: 1,
	timeSpent: null,
	isSpoiler: null,
	episodeNumber: 1,
	episodeRuntime: 66,
	id: "episode-review",
	consumedOn: "Jellyfin",
	episodeId: "episode-1",
	episodeName: "The Arrest",
	eventSchemaSlug: "review",
	createdAt: "2024-02-01T10:00:00.000Z",
	occurredAt: "2024-02-01T09:00:00.000Z",
};

const EPISODE_PROGRESS_ROW = {
	seasonNumber: 0,
	consumedOn: null,
	episodeNumber: 3,
	progressPercent: 40,
	episodeRuntime: null,
	id: "special-progress",
	episodeId: "special-3",
	episodeName: "Behind the scenes",
	createdAt: "2024-02-03T10:00:00.000Z",
	occurredAt: "2024-02-03T09:00:00.000Z",
};

const COLLECTION_EVENT_ROW = {
	id: "collection-added",
	collectionName: "Watchlist",
	collectionId: "collection-1",
	createdAt: "2024-01-31T10:00:00.000Z",
	occurredAt: "2024-01-31T09:00:00.000Z",
	eventSchemaSlug: "add-entity-to-collection",
};

const WATCH_DAY_ROW = {
	minutes: 45,
	runtime: 31,
	seasonNumber: 1,
	episodeNumber: 1,
	episodeId: "episode-1",
	consumedOn: "Jellyfin",
	episodeName: "The Arrest",
	day: "2024-02-01T00:00:00.000Z",
};

const aggregateRows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "aggregate" as const,
	pageInfo: { limit: 500, hasMore: false },
});

const SEASON_ROW = {
	id: "season-1",
	seasonNumber: 1,
	episodeTotal: 4,
	watchedTotal: 1,
	watchedMinutes: 66,
	watchedUnknownRuntime: 0,
};

const decodeActivity = (
	input: {
		readonly watchCount?: number;
		readonly seasons?: readonly Record<string, unknown>[];
		readonly watchDays?: readonly Record<string, unknown>[];
		readonly parentEvents?: readonly Record<string, unknown>[];
		readonly episodeEvents?: readonly Record<string, unknown>[];
		readonly episodeProgress?: readonly Record<string, unknown>[];
		readonly collectionEvents?: readonly Record<string, unknown>[];
	} = {},
) =>
	ACTIVITY_RECIPE.decode({
		data: {
			seasons: activityRows(input.seasons ?? [SEASON_ROW]),
			parentEvents: activityRows(input.parentEvents ?? []),
			episodeEvents: activityRows(input.episodeEvents ?? []),
			episodeProgress: progressRows(input.episodeProgress ?? []),
			watchDays: aggregateRows(input.watchDays ?? [WATCH_DAY_ROW]),
			collectionEvents: activityRows(input.collectionEvents ?? []),
			totals: activityRows([{ watchCount: input.watchCount ?? 0 }]),
		},
	});

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
	populationStatus: "ready",
	translationStatus: "none",
	productionStatus: "Ended",
	publishDate: "2025-03-13",
	genres: ["Drama", "Crime"],
	description: "A synopsis.",
	collections: {
		pageInfo: { limit: 6, hasMore: false },
		items: [{ name: "Completed", id: "collection-1" }],
	},
	images: [
		{ type: "remote", purpose: "backdrop", url: "https://images.test/backdrop.jpg" },
		{ type: "remote", purpose: "cover", url: "https://images.test/cover.jpg" },
	],
	watchProviders: [
		{
			link: null,
			country: "GB",
			providers: [{ image: null, name: "Netflix", offers: ["stream"] }],
		},
		{
			country: "US",
			link: "https://www.themoviedb.org/tv/1/watch?locale=US",
			providers: [
				{ name: "Netflix", offers: ["stream"], image: "https://images.test/netflix.jpg" },
				{ image: null, name: "Apple TV", offers: ["rent", "buy"] },
			],
		},
	],
};
describe("media show query recipes", () => {
	it("builds one presentation query for all requested show IDs", () => {
		const recipe = showPresentationRecipe(["show-2", "show-1", "show-2"]);
		const shows = recipe.document.queries["shows"];
		if (shows?.output.type !== "rows" || shows.where?.type !== "and") {
			throw new Error("Expected filtered presentation rows query");
		}

		expect(Object.keys(recipe.document.queries)).toEqual(["shows"]);
		expect(shows.output.pagination).toMatchObject({ limit: 100 });
		expect(shows.where.predicates[1]).toMatchObject({
			type: "in",
			values: [{ value: "show-2" }, { value: "show-1" }, { value: "show-2" }],
		});
		expect(shows.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"state",
			"images",
			"storedSeasons",
			"publishDate",
			"publishYear",
			"productionStatus",
			"storedEpisodes",
			"watchedEpisodes",
			"inProgressEpisodes",
		]);
	});

	it("decodes stored show presentation progress and rejects malformed artwork", () => {
		const recipe = showPresentationRecipe(["show-1"]);
		const row = {
			id: "show-1",
			storedSeasons: 2,
			name: "Severance",
			publishYear: 2022,
			publishDate: null,
			schemaSlug: "show",
			storedEpisodes: 19,
			watchedEpisodes: 11,
			state: "in_progress",
			inProgressEpisodes: 1,
			populationStatus: "ready",
			translationStatus: "none",
			productionStatus: "Returning Series",
			images: [{ type: "s3", purpose: "cover", key: "severance-cover" }],
		};

		expect(recipe.decode({ data: { shows: showRows([row]) } })).toMatchObject({
			success: [
				{
					id: "show-1",
					storedSeasons: 2,
					storedEpisodes: 19,
					watchedEpisodes: 11,
					inProgressEpisodes: 1,
				},
			],
		});
		expect(
			recipe.decode({ data: { shows: showRows([{ ...row, images: [{ url: 12, type: "ftp" }] }]) } })
				._tag,
		).toBe("Failure");
	});

	it("builds show seasons without nested episodes", () => {
		const recipe = showSeasonsRecipe({ seasonLimit: 4, entityId: "show-id" });
		const show = recipe.document.queries["show"];
		if (show?.output.type !== "rows") {
			throw new Error("Expected show rows query");
		}
		const seasons = show.output.include?.[0];

		expect(show.where).toMatchObject({ type: "and" });
		expect(show.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
		]);
		expect(seasons).toMatchObject({ limit: 4, key: "seasons" });
		expect(seasons?.include).toBeUndefined();
		expect(
			seasons && "fields" in seasons
				? seasons.fields.map((field) => ("key" in field ? field.key : null))
				: [],
		).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"seasonNumber",
			"images",
			"releaseDate",
			"description",
		]);
	});

	it("builds selected season episodes with the caller-owned limit", () => {
		const recipe = showSeasonEpisodesRecipe({ episodeLimit: 12, seasonId: "season-id" });
		const season = recipe.document.queries["season"];
		if (season?.output.type !== "rows") {
			throw new Error("Expected season rows query");
		}
		const episodes = season.output.include?.[0];

		expect(season.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
		]);
		expect(episodes).toMatchObject({ limit: 12, key: "episodes" });
		expect(
			episodes && "fields" in episodes
				? episodes.fields.map((field) => ("key" in field ? field.key : null))
				: [],
		).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"episodeNumber",
			"images",
			"seasonNumber",
			"runtime",
			"publishDate",
			"description",
			"state",
		]);
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
			"totalSeasons",
			"totalEpisodes",
		]);
		expect(show.output.include?.[0]).toMatchObject({ limit: 6, key: "collections" });
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
					collections: { items: [{ name: "Completed", id: "collection-1" }] },
					images: [
						{ type: "remote", purpose: "backdrop", url: "https://images.test/backdrop.jpg" },
						{ type: "remote", purpose: "cover", url: "https://images.test/cover.jpg" },
					],
				},
			},
		});
	});

	it("decodes a missing show as an absent summary and absent schema", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "missing" });

		expect(recipe.decode({ data: { show: showRows([]), requested: showRows([]) } })).toMatchObject({
			success: { show: null, entitySchemaSlug: null },
		});
	});

	it("decodes a non-show entity as an absent summary with its schema slug", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "book-1" });

		expect(
			recipe.decode({
				data: { show: showRows([]), requested: showRows([{ schemaSlug: "book" }]) },
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
							watchProviders: null,
							productionStatus: null,
						},
					]),
				},
			}),
		).toMatchObject({
			success: {
				show: {
					genres: null,
					images: null,
					publishYear: null,
					providerName: null,
					watchProviders: null,
				},
			},
		});
	});

	it("decodes each country's watch providers, offer kinds and link", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: { show: showRows([SHOW_SUMMARY_ROW]), requested: showRows([{ schemaSlug: "show" }]) },
			}),
		).toMatchObject({
			success: {
				show: {
					watchProviders: [
						{
							link: null,
							country: "GB",
							providers: [{ image: null, name: "Netflix", offers: ["stream"] }],
						},
						{
							country: "US",
							link: "https://www.themoviedb.org/tv/1/watch?locale=US",
							providers: [
								{ name: "Netflix", offers: ["stream"], image: "https://images.test/netflix.jpg" },
								{ image: null, name: "Apple TV", offers: ["rent", "buy"] },
							],
						},
					],
				},
			},
		});
	});

	it("rejects a watch provider offer kind outside the media contract", () => {
		const recipe = showSummaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					show: showRows([
						{
							...SHOW_SUMMARY_ROW,
							watchProviders: [
								{
									link: null,
									country: "US",
									providers: [{ image: null, name: "Netflix", offers: ["preorder"] }],
								},
							],
						},
					]),
				},
			})._tag,
		).toBe("Failure");
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
					show: showRows([{ ...SHOW_SUMMARY_ROW, images: [{ url: 12, type: "ftp" }] }]),
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
							images: [{ type: "remote", purpose: "poster", url: "https://images.test/a.jpg" }],
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
			"populationStatus",
			"translationStatus",
			"character",
		]);
		expect(companies.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"images",
			"order",
			"roles",
			"populationStatus",
			"translationStatus",
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
				expr: { type: "cast", target: "number", expr: { path: ["order"], type: "jsonPath" } },
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
				{ right: { value: "show", type: "literal" } },
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
		).toEqual(["id", "name", "images", "populationStatus", "translationStatus"]);
	});

	it("decodes show credits, companies and recommendations with their locators", () => {
		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					recommendations: showRows([
						{
							id: "show-2",
							name: "Bad Girls",
							populationStatus: "ready",
							translationStatus: "none",
							images: [{ type: "local", purpose: "cover", key: "bad-girls-cover" }],
						},
					]),
					companies: showRows([
						{
							order: 1,
							id: "company-1",
							name: "Warp Films",
							populationStatus: "ready",
							translationStatus: "none",
							roles: ["Production Company"],
							images: [{ type: "s3", purpose: "logo", key: "warp-logo" }],
						},
					]),
					people: showRows([
						{
							order: 1,
							id: "person-1",
							roles: ["Creator"],
							name: "Jack Thorne",
							character: "Narrator",
							populationStatus: "ready",
							translationStatus: "none",
							images: [{ type: "remote", purpose: "profile", url: "https://images.test/jack.jpg" }],
						},
					]),
				},
			}),
		).toMatchObject({
			success: {
				recommendations: {
					items: [
						{
							id: "show-2",
							name: "Bad Girls",
							images: [{ type: "local", purpose: "cover", key: "bad-girls-cover" }],
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
							images: [{ type: "s3", purpose: "logo", key: "warp-logo" }],
						},
					],
				},
				people: {
					items: [
						{
							order: 1,
							id: "person-1",
							roles: ["Creator"],
							name: "Jack Thorne",
							character: "Narrator",
							images: [{ type: "remote", purpose: "profile", url: "https://images.test/jack.jpg" }],
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
					recommendations: showRows([
						{
							images: null,
							id: "show-2",
							name: "Bad Girls",
							populationStatus: "ready",
							translationStatus: "none",
						},
					]),
					people: showRows([
						{
							order: null,
							roles: null,
							images: null,
							id: "person-1",
							character: null,
							name: "Jo Johnson",
							populationStatus: "ready",
							translationStatus: "none",
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
							images: [{ url: 12, type: "ftp" }],
						},
					]),
				},
			})._tag,
		).toBe("Failure");
	});
	it("builds show activity from parent, episode and progress queries with caller-owned limits", () => {
		const parentEvents = ACTIVITY_RECIPE.document.queries["parentEvents"];
		const episodeEvents = ACTIVITY_RECIPE.document.queries["episodeEvents"];
		const episodeProgress = ACTIVITY_RECIPE.document.queries["episodeProgress"];
		if (
			parentEvents?.output.type !== "rows" ||
			episodeEvents?.output.type !== "rows" ||
			episodeProgress?.output.type !== "rows"
		) {
			throw new Error("Expected parent, episode and progress rows queries");
		}

		expect(parentEvents.joins).toBeUndefined();
		expect(parentEvents.output.pagination).toMatchObject({ limit: 60 });
		expect(episodeEvents.output.pagination).toMatchObject({ limit: 100 });
		expect(episodeProgress.output.pagination).toMatchObject({ limit: 100 });
		expect(parentEvents.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
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
			"eventSchemaSlug",
		]);
		expect(episodeEvents.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual(
			[
				"id",
				"createdAt",
				"occurredAt",
				"text",
				"rating",
				"timeSpent",
				"consumedOn",
				"isSpoiler",
				"episodeId",
				"episodeName",
				"seasonNumber",
				"episodeNumber",
				"episodeRuntime",
				"eventSchemaSlug",
			],
		);
		expect(
			episodeProgress.output.fields.map((field) => ("key" in field ? field.key : null)),
		).toEqual(["episodeId", "episodeName", "seasonNumber", "episodeNumber", "episodeRuntime"]);
	});

	it("counts every season's episodes for coverage, specials included", () => {
		const seasons = ACTIVITY_RECIPE.document.queries["seasons"];
		if (seasons?.output.type !== "rows" || seasons.where?.type !== "and") {
			throw new Error("Expected filtered season rows query");
		}

		expect(seasons.output.pagination).toMatchObject({ limit: 50 });
		expect(seasons.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"seasonNumber",
			"episodeTotal",
			"watchedTotal",
			"watchedUnknownRuntime",
			"watchedMinutes",
		]);
		expect(seasons.where.predicates[1]).toMatchObject({
			type: "comparison",
			right: { type: "literal", value: "show-1" },
			left: { field: "sourceEntityId", tableAlias: "coverageShowSeason" },
		});
		expect(
			seasons.where.predicates.some(
				(predicate) => predicate.type === "comparison" && predicate.operator === "gt",
			),
		).toBe(false);
	});

	it("scopes parent activity to the show entity and its lifecycle events", () => {
		const parentEvents = ACTIVITY_RECIPE.document.queries["parentEvents"];
		if (parentEvents?.output.type !== "rows" || parentEvents.where?.type !== "and") {
			throw new Error("Expected filtered parent event rows query");
		}

		expect(parentEvents.where.predicates[0]).toMatchObject({
			type: "comparison",
			right: { type: "literal", value: "show-1" },
			left: { field: "entityId", tableAlias: "parentEvent" },
		});
		expect(parentEvents.where.predicates[1]).toMatchObject({
			type: "in",
			values: [
				{ value: "backlog" },
				{ value: "on_hold" },
				{ value: "dropped" },
				{ value: "complete" },
				{ value: "review" },
			],
		});
	});

	it("scopes collection activity to membership events that name the show as their subject", () => {
		const collectionEvents = ACTIVITY_RECIPE.document.queries["collectionEvents"];
		if (collectionEvents?.output.type !== "rows" || collectionEvents.where?.type !== "and") {
			throw new Error("Expected filtered collection event rows query");
		}

		expect(collectionEvents.output.pagination).toMatchObject({ limit: 40 });
		expect(collectionEvents.joins?.map((join) => join.table.alias)).toEqual(["eventCollection"]);
		expect(
			collectionEvents.output.fields.map((field) => ("key" in field ? field.key : null)),
		).toEqual([
			"id",
			"collectionId",
			"collectionName",
			"createdAt",
			"occurredAt",
			"eventSchemaSlug",
		]);
		expect(collectionEvents.where.predicates[0]).toMatchObject({
			type: "comparison",
			right: { type: "literal", value: "collection" },
			left: { field: "entitySchemaSlug", tableAlias: "eventCollection" },
		});
		expect(collectionEvents.where.predicates[1]).toMatchObject({
			type: "in",
			values: [{ value: "add-entity-to-collection" }, { value: "remove-entity-from-collection" }],
		});
		expect(collectionEvents.where.predicates[2]).toMatchObject({
			type: "comparison",
			right: { type: "literal", value: "show-1" },
		});
	});

	it("reaches episode activity through season relationships instead of the event session", () => {
		const episodeEvents = ACTIVITY_RECIPE.document.queries["episodeEvents"];
		if (episodeEvents?.output.type !== "rows" || episodeEvents.where?.type !== "and") {
			throw new Error("Expected filtered episode event rows query");
		}
		const membership = episodeEvents.where.predicates[2];
		if (membership?.type !== "exists") {
			throw new Error("Expected an episode membership existence predicate");
		}

		expect(JSON.stringify(episodeEvents)).not.toContain("sessionEntityId");
		expect(JSON.stringify(membership)).not.toContain("seasonNumber");
		expect(membership.query.from).toMatchObject({
			table: "relationship",
			alias: "episodeEventShowShowSeason",
		});
		expect(membership.query.joins?.map((join) => join.table.alias)).toEqual([
			"episodeEventShowSeason",
			"episodeEventShowSeasonEpisode",
		]);
	});

	it("selects one collapsed progress milestone for every episode that recorded progress", () => {
		const episodeProgress = ACTIVITY_RECIPE.document.queries["episodeProgress"];
		if (episodeProgress?.output.type !== "rows") {
			throw new Error("Expected progress rows query");
		}
		const milestone = episodeProgress.output.include?.[0];

		expect(episodeProgress.from).toMatchObject({ table: "entity", alias: "progressEpisode" });
		expect(milestone).toMatchObject({
			limit: 1,
			key: "milestone",
			orderBy: [
				{ direction: "desc", expr: { field: "occurredAt" } },
				{ direction: "desc", expr: { field: "createdAt" } },
				{ direction: "desc", expr: { field: "id" } },
			],
		});
		expect(
			milestone && "fields" in milestone
				? milestone.fields.map((field) => ("key" in field ? field.key : null))
				: [],
		).toEqual(["id", "createdAt", "occurredAt", "consumedOn", "progressPercent"]);
	});

	it("merges activity queries into one authoritative descending event order", () => {
		const sameInstant = { occurredAt: "2024-02-04T09:00:00.000Z" };

		expect(
			decodeActivity({
				episodeEvents: [EPISODE_EVENT_ROW],
				episodeProgress: [EPISODE_PROGRESS_ROW],
				parentEvents: [
					{ ...PARENT_EVENT_ROW, ...sameInstant, id: "b", createdAt: "2024-02-04T10:00:00.000Z" },
					{ ...PARENT_EVENT_ROW, ...sameInstant, id: "a", createdAt: "2024-02-04T10:00:00.000Z" },
					{ ...PARENT_EVENT_ROW, ...sameInstant, id: "c", createdAt: "2024-02-04T11:00:00.000Z" },
				],
			}),
		).toMatchObject({
			success: {
				truncated: false,
				events: [
					{ id: "c" },
					{ id: "b" },
					{ id: "a" },
					{ id: "special-progress" },
					{ id: "episode-review" },
				],
			},
		});
	});

	it("keeps parent activity separate from episode activity without duplicating rows", () => {
		const decoded = decodeActivity({
			parentEvents: [PARENT_EVENT_ROW],
			episodeEvents: [EPISODE_EVENT_ROW],
			episodeProgress: [EPISODE_PROGRESS_ROW],
		});
		if (decoded._tag === "Failure") {
			throw new Error("Expected a decoded activity result");
		}

		expect(decoded.success.events.map((event) => event.kind)).toEqual([
			"episode",
			"parent",
			"episode",
		]);
		expect(decoded.success.events.filter((event) => event.kind === "parent")).toMatchObject([
			{ id: "parent-complete", eventSchemaSlug: "complete" },
		]);
	});

	it("decodes special-episode progress with its season and episode identity", () => {
		expect(decodeActivity({ episodeProgress: [EPISODE_PROGRESS_ROW] })).toMatchObject({
			success: {
				events: [
					{
						progressPercent: 40,
						eventSchemaSlug: "progress",
						episode: {
							runtime: null,
							id: "special-3",
							seasonNumber: 0,
							episodeNumber: 3,
							name: "Behind the scenes",
						},
					},
				],
			},
		});
	});

	it("decodes activity whose optional event properties were never recorded", () => {
		expect(
			decodeActivity({
				parentEvents: [{ ...PARENT_EVENT_ROW, eventSchemaSlug: "review" }],
				episodeProgress: [{ ...EPISODE_PROGRESS_ROW, progressPercent: null }],
				episodeEvents: [
					{ ...EPISODE_EVENT_ROW, timeSpent: null, consumedOn: null, episodeRuntime: null },
				],
			}),
		).toMatchObject({
			success: {
				events: [
					{ consumedOn: null, progressPercent: null },
					{ text: null, rating: null, isSpoiler: null, eventSchemaSlug: "review" },
					{ timeSpent: null, consumedOn: null, episode: { runtime: null } },
				],
			},
		});
	});

	it("decodes a review with its rating, body and spoiler flag", () => {
		expect(
			decodeActivity({
				parentEvents: [
					{
						...PARENT_EVENT_ROW,
						rating: 82,
						isSpoiler: true,
						id: "parent-review",
						eventSchemaSlug: "review",
						text: "The ending recontextualises everything.",
					},
				],
			}),
		).toMatchObject({
			success: {
				events: [
					{
						rating: 82,
						isSpoiler: true,
						eventSchemaSlug: "review",
						text: "The ending recontextualises everything.",
					},
				],
			},
		});
	});

	it("reports truncation when any activity page holds more rows", () => {
		expect(
			ACTIVITY_RECIPE.decode({
				data: {
					episodeProgress: activityRows([]),
					collectionEvents: activityRows([]),
					seasons: activityRows([SEASON_ROW]),
					totals: activityRows([{ watchCount: 1 }]),
					watchDays: aggregateRows([WATCH_DAY_ROW]),
					parentEvents: activityRows([PARENT_EVENT_ROW]),
					episodeEvents: rowsResult([EPISODE_EVENT_ROW], {
						limit: 100,
						hasMore: true,
						nextCursor: "episode-cursor",
					}),
				},
			}),
		).toMatchObject({ success: { truncated: true } });
	});

	it("decodes collection membership changes into the shared descending event order", () => {
		expect(
			decodeActivity({
				parentEvents: [PARENT_EVENT_ROW],
				collectionEvents: [
					COLLECTION_EVENT_ROW,
					{
						...COLLECTION_EVENT_ROW,
						id: "collection-removed",
						createdAt: "2024-02-03T10:00:00.000Z",
						occurredAt: "2024-02-03T09:00:00.000Z",
						eventSchemaSlug: "remove-entity-from-collection",
					},
				],
			}),
		).toMatchObject({
			success: {
				events: [
					{
						text: null,
						rating: null,
						timeSpent: null,
						consumedOn: null,
						kind: "collection",
						id: "collection-removed",
						eventSchemaSlug: "remove-entity-from-collection",
						collection: { name: "Watchlist", id: "collection-1" },
					},
					{ kind: "parent", id: "parent-complete" },
					{
						kind: "collection",
						id: "collection-added",
						eventSchemaSlug: "add-entity-to-collection",
						collection: { name: "Watchlist", id: "collection-1" },
					},
				],
			},
		});
	});

	it("reports truncation when the collection membership page holds more rows", () => {
		expect(
			ACTIVITY_RECIPE.decode({
				data: {
					parentEvents: activityRows([]),
					episodeEvents: activityRows([]),
					episodeProgress: progressRows([]),
					seasons: activityRows([SEASON_ROW]),
					totals: activityRows([{ watchCount: 1 }]),
					watchDays: aggregateRows([WATCH_DAY_ROW]),
					collectionEvents: rowsResult([COLLECTION_EVENT_ROW], {
						limit: 40,
						hasMore: true,
						nextCursor: "collection-cursor",
					}),
				},
			}),
		).toMatchObject({ success: { truncated: true } });
	});

	it("rejects collection activity whose event schema slug is not a membership change", () => {
		expect(
			decodeActivity({ collectionEvents: [{ ...COLLECTION_EVENT_ROW, eventSchemaSlug: "review" }] })
				._tag,
		).toBe("Failure");
	});

	it("decodes a show with no recorded activity as an empty event list", () => {
		expect(decodeActivity()).toMatchObject({ success: { events: [], truncated: false } });
	});

	it("rejects activity whose event schema slug is outside the media lifecycle", () => {
		expect(
			decodeActivity({ parentEvents: [{ ...PARENT_EVENT_ROW, eventSchemaSlug: "watched" }] })._tag,
		).toBe("Failure");
	});

	it("counts a season's episodes independently of the events that were fetched", () => {
		expect(
			decodeActivity({
				episodeEvents: [EPISODE_EVENT_ROW],
				seasons: [
					{ ...SEASON_ROW, id: "season-0", seasonNumber: 0, episodeTotal: 2 },
					{ ...SEASON_ROW, id: "season-1", seasonNumber: 1, episodeTotal: 6 },
				],
			}),
		).toMatchObject({
			success: {
				seasons: [
					{ seasonNumber: 0, episodeTotal: 2 },
					{ seasonNumber: 1, episodeTotal: 6 },
				],
			},
		});
	});
});
