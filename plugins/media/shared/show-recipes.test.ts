import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { showRecipes, showSeasonEpisodesRecipe, showSeasonsRecipe } from "./show-recipes";

const showRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

const ACTIVITY_RECIPE = showRecipes.activityRecipe({
	timeZone: "UTC",
	coverageLimit: 50,
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
		readonly coverage?: readonly Record<string, unknown>[];
		readonly watchDays?: readonly Record<string, unknown>[];
		readonly parentEvents?: readonly Record<string, unknown>[];
		readonly episodeEvents?: readonly Record<string, unknown>[];
		readonly episodeProgress?: readonly Record<string, unknown>[];
		readonly collectionEvents?: readonly Record<string, unknown>[];
	} = {},
) =>
	ACTIVITY_RECIPE.decode({
		data: {
			parentEvents: activityRows(input.parentEvents ?? []),
			coverage: activityRows(input.coverage ?? [SEASON_ROW]),
			episodeEvents: activityRows(input.episodeEvents ?? []),
			episodeProgress: progressRows(input.episodeProgress ?? []),
			watchDays: aggregateRows(input.watchDays ?? [WATCH_DAY_ROW]),
			collectionEvents: activityRows(input.collectionEvents ?? []),
			totals: activityRows([{ watchCount: input.watchCount ?? 0 }]),
		},
	});

const OVERVIEW_RECIPE = showRecipes.overviewRecipe({
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
	storedEpisodes: 4,
	isMonitored: true,
	publishYear: 2025,
	state: "complete",
	watchedEpisodes: 1,
	schemaSlug: "show",
	name: "Adolescence",
	providerName: "TMDB",
	inProgressEpisodes: 0,
	providerRating: 78.25,
	isInMediaLibrary: true,
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
		const recipe = showRecipes.presentationRecipe(["show-2", "show-1", "show-2"]);
		const shows = recipe.document.queries["rows"];
		if (shows?.output.type !== "rows" || shows.where?.type !== "and") {
			throw new Error("Expected filtered presentation rows query");
		}

		expect(Object.keys(recipe.document.queries)).toEqual(["rows"]);
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
			"publishDate",
			"publishYear",
			"productionStatus",
			"storedEpisodes",
			"watchedEpisodes",
			"inProgressEpisodes",
			"storedSeasons",
		]);
	});

	it("decodes stored show presentation progress and rejects malformed artwork", () => {
		const recipe = showRecipes.presentationRecipe(["show-1"]);
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

		expect(recipe.decode({ data: { rows: showRows([row]) } })).toMatchObject({
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
			recipe.decode({ data: { rows: showRows([{ ...row, images: [{ url: 12, type: "ftp" }] }]) } })
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
			"episodeTotal",
			"watchedTotal",
			"watchedUnknownRuntime",
			"watchedMinutes",
		]);
	});

	it("pages a season's episodes ascending as a top-level row query", () => {
		const recipe = showSeasonEpisodesRecipe({ limit: 12, containerId: "season-id" });
		const episodes = recipe.document.queries["episodes"];
		if (episodes?.output.type !== "rows" || episodes.where?.type !== "and") {
			throw new Error("Expected a filtered episode rows query");
		}

		expect(Object.keys(recipe.document.queries)).toEqual(["episodes"]);
		expect(episodes.output.pagination).toEqual({ limit: 12 });
		expect(episodes.output.orderBy.map(({ direction }) => direction)).toEqual(["asc", "asc"]);
		expect(episodes.where.predicates[1]).toMatchObject({
			type: "comparison",
			right: { type: "literal", value: "season-id" },
		});
		expect(episodes.where.predicates[2]).toMatchObject({
			type: "comparison",
			right: { type: "literal", value: "show-season-to-show-episode" },
		});
		expect(episodes.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"images",
			"episodeNumber",
			"runtime",
			"publishDate",
			"description",
			"state",
			"seasonNumber",
		]);
	});

	it("resumes a season's episodes from the cursor the previous page handed back", () => {
		const recipe = showSeasonEpisodesRecipe({
			limit: 12,
			after: "season-cursor",
			containerId: "season-id",
		});
		const episodes = recipe.document.queries["episodes"];
		if (episodes?.output.type !== "rows") {
			throw new Error("Expected an episode rows query");
		}

		expect(episodes.output.pagination).toEqual({ limit: 12, after: "season-cursor" });
	});

	it("selects the show summary alongside the requested entity schema", () => {
		const recipe = showRecipes.summaryRecipe({ collectionLimit: 6, entityId: "show-1" });
		const summary = recipe.document.queries["summary"];
		const requested = recipe.document.queries["requested"];
		if (summary?.output.type !== "rows" || requested?.output.type !== "rows") {
			throw new Error("Expected summary and requested rows queries");
		}

		expect(requested.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"schemaSlug",
		]);
		expect(summary.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
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
			"totalEpisodes",
			"storedEpisodes",
			"watchedEpisodes",
			"inProgressEpisodes",
			"watchProviders",
			"totalSeasons",
		]);
		expect(summary.output.include?.[0]).toMatchObject({ limit: 6, key: "collections" });
		expect(summary.joins?.[0]).toMatchObject({ type: "left", table: { alias: "provider" } });
	});

	it("decodes a show summary with collections and asset locators", () => {
		const recipe = showRecipes.summaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					summary: showRows([SHOW_SUMMARY_ROW]),
					requested: showRows([{ schemaSlug: "show" }]),
				},
			}),
		).toMatchObject({
			success: {
				entitySchemaSlug: "show",
				summary: {
					owned: null,
					id: "show-1",
					state: "complete",
					publishYear: 2025,
					isMonitored: true,
					providerName: "TMDB",
					isInMediaLibrary: true,
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
		const recipe = showRecipes.summaryRecipe({ collectionLimit: 6, entityId: "missing" });

		expect(
			recipe.decode({ data: { summary: showRows([]), requested: showRows([]) } }),
		).toMatchObject({ success: { summary: null, entitySchemaSlug: null } });
	});

	it("decodes a non-show entity as an absent summary with its schema slug", () => {
		const recipe = showRecipes.summaryRecipe({ collectionLimit: 6, entityId: "book-1" });

		expect(
			recipe.decode({
				data: { summary: showRows([]), requested: showRows([{ schemaSlug: "book" }]) },
			}),
		).toMatchObject({ success: { summary: null, entitySchemaSlug: "book" } });
	});

	it("decodes omitted optional show properties as null", () => {
		const recipe = showRecipes.summaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					summary: showRows([
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
				summary: {
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
		const recipe = showRecipes.summaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					summary: showRows([SHOW_SUMMARY_ROW]),
					requested: showRows([{ schemaSlug: "show" }]),
				},
			}),
		).toMatchObject({
			success: {
				summary: {
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
		const recipe = showRecipes.summaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					summary: showRows([
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
		const recipe = showRecipes.summaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					summary: showRows([{ ...SHOW_SUMMARY_ROW, state: "watching" }]),
				},
			})._tag,
		).toBe("Failure");
	});

	it("rejects a show summary whose image locators are malformed", () => {
		const recipe = showRecipes.summaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					summary: showRows([{ ...SHOW_SUMMARY_ROW, images: [{ url: 12, type: "ftp" }] }]),
				},
			})._tag,
		).toBe("Failure");
	});

	it("rejects a show summary whose image purpose is outside the media contract", () => {
		const recipe = showRecipes.summaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					summary: showRows([
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
		const recipe = showRecipes.summaryRecipe({ collectionLimit: 6, entityId: "show-1" });

		expect(
			recipe.decode({
				data: {
					requested: showRows([{ schemaSlug: "show" }]),
					summary: showRows([
						{ ...SHOW_SUMMARY_ROW, images: [{ type: "s3", key: "legacy-image" }] },
					]),
				},
			}),
		).toMatchObject({ success: { summary: { images: [{ type: "s3", key: "legacy-image" }] } } });
	});

	it("reads show credits from the relationship side that points at the show", () => {
		const recipe = showRecipes.overviewRecipe({
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
		const recipe = showRecipes.overviewRecipe({
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
		const recipe = showRecipes.overviewRecipe({
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
			"isSpoiler",
			"timeSpent",
			"consumedOn",
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
				"isSpoiler",
				"timeSpent",
				"consumedOn",
				"episodeId",
				"episodeName",
				"episodeNumber",
				"episodeRuntime",
				"seasonNumber",
				"eventSchemaSlug",
			],
		);
		expect(
			episodeProgress.output.fields.map((field) => ("key" in field ? field.key : null)),
		).toEqual(["episodeId", "episodeName", "episodeNumber", "episodeRuntime", "seasonNumber"]);
	});

	it("counts every season's episodes for coverage, specials included", () => {
		const seasons = ACTIVITY_RECIPE.document.queries["coverage"];
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
		expect(membership.query.from).toMatchObject({ table: "relationship" });
		expect(membership.query.joins?.map((join) => join.table.table)).toEqual([
			"entity",
			"relationship",
		]);
		expect(JSON.stringify(membership)).toContain("show-to-show-season");
		expect(JSON.stringify(membership)).toContain("show-season-to-show-episode");
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

	it("counts a season's episodes independently of the events that were fetched", () => {
		expect(
			decodeActivity({
				episodeEvents: [EPISODE_EVENT_ROW],
				coverage: [
					{ ...SEASON_ROW, id: "season-0", seasonNumber: 0, episodeTotal: 2 },
					{ ...SEASON_ROW, id: "season-1", seasonNumber: 1, episodeTotal: 6 },
				],
			}),
		).toMatchObject({
			success: {
				coverage: [
					{ seasonNumber: 0, episodeTotal: 2 },
					{ seasonNumber: 1, episodeTotal: 6 },
				],
			},
		});
	});
});
