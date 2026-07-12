import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { episodicParentCoverageQuery, mediaEpisodicRecipes } from "./episodic-recipes";
import { podcastEpisodicKindConfig, showEpisodicKindConfig } from "./lifecycle-expressions";

const fixtureRecipes = mediaEpisodicRecipes({
	slug: "podcast",
	alias: "fixture",
	orderProperties: [],
	summaryFields: () => ({}),
	episodeFields: () => ({}),
	presentationFields: () => ({}),
	config: podcastEpisodicKindConfig,
	activityEpisode: (row) => ({
		id: row.episodeId,
		name: row.episodeName,
		runtime: row.episodeRuntime,
		episodeNumber: row.episodeNumber,
	}),
	coverageQuery: episodicParentCoverageQuery({
		slug: "podcast",
		alias: "fixture",
		episodeSchemaSlug: "podcast-episode",
		relationshipSlug: "podcast-to-podcast-episode",
	}),
});

const nestedRecipes = mediaEpisodicRecipes({
	slug: "show",
	alias: "nested",
	summaryFields: () => ({}),
	episodeFields: () => ({}),
	presentationFields: () => ({}),
	config: showEpisodicKindConfig,
	orderProperties: ["seasonNumber"],
	activityEpisode: (row) => ({
		id: row.episodeId,
		name: row.episodeName,
		runtime: row.episodeRuntime,
		episodeNumber: row.episodeNumber,
	}),
	coverageQuery: episodicParentCoverageQuery({
		slug: "show",
		alias: "nested",
		episodeSchemaSlug: "show-episode",
		relationshipSlug: "show-season-to-show-episode",
	}),
});

const rows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 100, hasMore: false, nextCursor: null });

const aggregateRows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "aggregate" as const,
	pageInfo: { limit: 500, hasMore: false },
});

const progressRows = (items: readonly Record<string, unknown>[]) =>
	rows(
		items.map(({ id, createdAt, occurredAt, consumedOn, progressPercent, ...episode }) => ({
			...episode,
			milestone: {
				pageInfo: { limit: 1, hasMore: false },
				items: [{ id, createdAt, occurredAt, consumedOn, progressPercent }],
			},
		})),
	);

const ACTIVITY_INPUT = {
	timeZone: "UTC",
	coverageLimit: 50,
	watchDayLimit: 500,
	entityId: "parent-1",
	parentEventLimit: 60,
	episodeEventLimit: 100,
	collectionEventLimit: 40,
	episodeProgressLimit: 100,
};

const COVERAGE_ROW = {
	id: "parent-1",
	episodeTotal: 6,
	watchedTotal: 2,
	watchedMinutes: 66,
	watchedUnknownRuntime: 0,
};

const activityRecipe = () => fixtureRecipes.activityRecipe(ACTIVITY_INPUT);

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
	consumedOn: null,
	episodeNumber: 3,
	progressPercent: 40,
	episodeRuntime: null,
	id: "episode-progress",
	episodeId: "episode-3",
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
	episodeNumber: 1,
	episodeId: "episode-1",
	consumedOn: "Jellyfin",
	episodeName: "The Arrest",
	day: "2024-02-01T00:00:00.000Z",
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
	activityRecipe().decode({
		data: {
			parentEvents: rows(input.parentEvents ?? []),
			episodeEvents: rows(input.episodeEvents ?? []),
			coverage: rows(input.coverage ?? [COVERAGE_ROW]),
			collectionEvents: rows(input.collectionEvents ?? []),
			totals: rows([{ watchCount: input.watchCount ?? 0 }]),
			episodeProgress: progressRows(input.episodeProgress ?? []),
			watchDays: aggregateRows(input.watchDays ?? [WATCH_DAY_ROW]),
		},
	});

describe("episodic media recipes", () => {
	it("selects the parent summary with its episodic state and episode aggregates", () => {
		const recipe = fixtureRecipes.summaryRecipe({ collectionLimit: 6, entityId: "parent-1" });
		const summary = recipe.document.queries["summary"];
		if (summary?.output.type !== "rows") {
			throw new Error("Expected a summary rows query");
		}

		expect(summary.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
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
		]);
		expect(summary.output.include?.[0]).toMatchObject({ limit: 6, key: "collections" });
	});

	it("counts a flat parent's episodes through its own relationship", () => {
		const recipe = fixtureRecipes.presentationRecipe(["parent-1"]);
		const document = JSON.stringify(recipe.document);

		expect(document).toContain("podcast-to-podcast-episode");
		expect(document).not.toContain("show-season-to-show-episode");
	});

	it("counts a nested parent's episodes through its seasons", () => {
		const recipe = nestedRecipes.presentationRecipe(["parent-1"]);
		const document = JSON.stringify(recipe.document);

		expect(document).toContain("show-to-show-season");
		expect(document).toContain("show-season-to-show-episode");
	});

	it("reaches episode activity through the parent's nesting instead of the event session", () => {
		const flat = activityRecipe().document.queries["episodeEvents"];
		const nested = nestedRecipes.activityRecipe(ACTIVITY_INPUT).document.queries["episodeEvents"];
		if (flat?.output.type !== "rows" || nested?.output.type !== "rows") {
			throw new Error("Expected episode event rows queries");
		}
		const flatMembership = flat.where?.type === "and" ? flat.where.predicates[2] : undefined;
		const nestedMembership = nested.where?.type === "and" ? nested.where.predicates[2] : undefined;
		if (flatMembership?.type !== "exists" || nestedMembership?.type !== "exists") {
			throw new Error("Expected episode membership existence predicates");
		}

		expect(JSON.stringify(flat)).not.toContain("sessionEntityId");
		expect(flatMembership.query.joins).toBeUndefined();
		expect(nestedMembership.query.joins).toHaveLength(2);
	});

	it("orders in-progress episodes by the schema's own episode ordering", () => {
		const flat = activityRecipe().document.queries["episodeProgress"];
		const nested = nestedRecipes.activityRecipe(ACTIVITY_INPUT).document.queries["episodeProgress"];
		if (flat?.output.type !== "rows" || nested?.output.type !== "rows") {
			throw new Error("Expected progress rows queries");
		}

		expect(flat.output.orderBy).toHaveLength(2);
		expect(nested.output.orderBy).toHaveLength(3);
	});

	it("selects one collapsed progress milestone for every episode that recorded progress", () => {
		const episodeProgress = activityRecipe().document.queries["episodeProgress"];
		if (episodeProgress?.output.type !== "rows") {
			throw new Error("Expected progress rows query");
		}
		const milestone = episodeProgress.output.include?.[0];

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

	it("honours the caller's limits on every activity page", () => {
		const document = activityRecipe().document;
		const parentEvents = document.queries["parentEvents"];
		const episodeEvents = document.queries["episodeEvents"];
		const collectionEvents = document.queries["collectionEvents"];
		if (
			parentEvents?.output.type !== "rows" ||
			episodeEvents?.output.type !== "rows" ||
			collectionEvents?.output.type !== "rows"
		) {
			throw new Error("Expected parent, episode and collection rows queries");
		}

		expect(parentEvents.joins).toBeUndefined();
		expect(parentEvents.output.pagination).toMatchObject({ limit: 60 });
		expect(episodeEvents.output.pagination).toMatchObject({ limit: 100 });
		expect(collectionEvents.output.pagination).toMatchObject({ limit: 40 });
	});

	it("merges parent, episode and progress rows into one descending event order", () => {
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
					{ id: "episode-progress" },
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

	it("decodes episode progress with the episode identity the row carries", () => {
		expect(decodeActivity({ episodeProgress: [EPISODE_PROGRESS_ROW] })).toMatchObject({
			success: {
				events: [
					{
						progressPercent: 40,
						eventSchemaSlug: "progress",
						episode: {
							runtime: null,
							id: "episode-3",
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
						kind: "collection",
						id: "collection-removed",
						eventSchemaSlug: "remove-entity-from-collection",
						collection: { name: "Watchlist", id: "collection-1" },
					},
					{ kind: "parent", id: "parent-complete" },
					{ kind: "collection", id: "collection-added" },
				],
			},
		});
	});

	it("reports truncation when any activity page holds more rows", () => {
		expect(
			activityRecipe().decode({
				data: {
					parentEvents: rows([]),
					collectionEvents: rows([]),
					coverage: rows([COVERAGE_ROW]),
					episodeProgress: progressRows([]),
					totals: rows([{ watchCount: 1 }]),
					watchDays: aggregateRows([WATCH_DAY_ROW]),
					episodeEvents: rowsResult([EPISODE_EVENT_ROW], {
						limit: 100,
						hasMore: true,
						nextCursor: "episode-cursor",
					}),
				},
			}),
		).toMatchObject({ success: { truncated: true } });
	});

	it("rejects activity whose event schema slug is outside the media lifecycle", () => {
		expect(
			decodeActivity({ parentEvents: [{ ...PARENT_EVENT_ROW, eventSchemaSlug: "watched" }] })._tag,
		).toBe("Failure");
	});

	it("decodes a parent with no recorded activity as an empty event list", () => {
		expect(decodeActivity()).toMatchObject({ success: { events: [], truncated: false } });
	});

	it("carries the coverage rows and watch count the schema asked for", () => {
		expect(decodeActivity({ watchCount: 3 })).toMatchObject({
			success: { watchCount: 3, coverage: [{ id: "parent-1", episodeTotal: 6, watchedTotal: 2 }] },
		});
	});
});
