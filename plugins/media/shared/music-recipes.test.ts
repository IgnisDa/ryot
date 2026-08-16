import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import {
	musicActivityRecipe,
	musicOverviewRecipe,
	musicPresentationRecipe,
	musicSummaryRecipe,
} from "./music-recipes";

const musicRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

const activityRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 60, hasMore: false, nextCursor: null });

const SUMMARY_RECIPE = musicSummaryRecipe({ collectionLimit: 6, entityId: "music-1" });

const OVERVIEW_RECIPE = musicOverviewRecipe({
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "music-1",
	recommendationLimit: 12,
});

const ACTIVITY_RECIPE = musicActivityRecipe({
	eventLimit: 60,
	entityId: "music-1",
	collectionEventLimit: 40,
});

const MUSIC_SUMMARY_ROW = {
	owned: null,
	genres: null,
	images: null,
	duration: 222,
	id: "music-1",
	publishYear: 1997,
	state: "complete",
	isInLibrary: true,
	description: null,
	publishDate: null,
	isMonitored: false,
	schemaSlug: "music",
	providerRating: 92.5,
	progressPercent: null,
	byVariousArtists: false,
	name: "Paranoid Android",
	populationStatus: "ready",
	translationStatus: "none",
	providerName: "MusicBrainz",
	productionStatus: "Released",
	collections: { items: [], pageInfo: { limit: 6, hasMore: false } },
};

describe("media music query recipes", () => {
	it("selects only the fields the music schema declares", () => {
		const music = SUMMARY_RECIPE.document.queries["music"];
		if (music?.output.type !== "rows") {
			throw new Error("Expected a music rows query");
		}

		expect(music.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
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
			"duration",
			"byVariousArtists",
		]);
	});

	it("decodes a music summary with its duration in seconds and flat lifecycle state", () => {
		expect(
			SUMMARY_RECIPE.decode({
				data: {
					requested: musicRows([{ schemaSlug: "music" }]),
					music: musicRows([{ ...MUSIC_SUMMARY_ROW, progressPercent: 42, state: "in_progress" }]),
				},
			}),
		).toMatchObject({
			success: {
				entitySchemaSlug: "music",
				music: {
					duration: 222,
					id: "music-1",
					progressPercent: 42,
					state: "in_progress",
					byVariousArtists: false,
				},
			},
		});
	});

	it("rejects a music summary whose lifecycle state is episodic", () => {
		expect(
			SUMMARY_RECIPE.decode({
				data: {
					requested: musicRows([{ schemaSlug: "music" }]),
					music: musicRows([{ ...MUSIC_SUMMARY_ROW, state: "caught_up" }]),
				},
			})._tag,
		).toBe("Failure");
	});

	it("decodes a non-music entity as an absent summary with its schema slug", () => {
		expect(
			SUMMARY_RECIPE.decode({
				data: { music: musicRows([]), requested: musicRows([{ schemaSlug: "movie" }]) },
			}),
		).toMatchObject({ success: { music: null, entitySchemaSlug: "movie" } });
	});

	it("reads credits and recommendations from the music side of each relationship", () => {
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
			predicates: [{}, {}, { right: { type: "literal", value: "person-to-music" } }],
		});
		expect(companies.where).toMatchObject({
			predicates: [{}, {}, { right: { type: "literal", value: "company-to-music" } }],
		});
		expect(recommendations.where).toMatchObject({
			predicates: [{ right: { value: "music", type: "literal" } }, {}, {}],
		});
	});

	it("reaches the album from the group side of music-group-to-music", () => {
		const group = OVERVIEW_RECIPE.document.queries["group"];
		if (group?.output.type !== "rows") {
			throw new Error("Expected a group rows query");
		}

		expect(group.from).toMatchObject({ table: "entity", alias: "musicGroup" });
		expect(group.where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "music-group" } },
				{
					right: { type: "literal", value: "music-1" },
					left: { field: "targetEntityId", tableAlias: "musicGroupRelationship" },
				},
				{ right: { type: "literal", value: "music-group-to-music" } },
			],
		});
	});

	it("excludes the subject track from its own album rail", () => {
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
				{ right: { value: "music", type: "literal" } },
				{
					operator: "neq",
					right: { type: "literal", value: "music-1" },
					left: { field: "id", tableAlias: "groupMember" },
				},
				{},
				{},
			],
		});
	});

	it("converts the duration to minutes before summing listened time", () => {
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
			throw new Error("Expected the consumed minutes aggregate");
		}
		expect(minutes.expr).toMatchObject({
			type: "aggregate",
			aggregation: {
				function: "sum",
				expr: {
					type: "coalesce",
					values: [{}, { type: "arithmetic", operator: "divide", right: { value: 60 } }],
				},
			},
		});
		expect(JSON.stringify(minutes.expr)).toContain("duration");
	});

	it("merges music and collection events into one descending order", () => {
		expect(
			ACTIVITY_RECIPE.decode({
				data: {
					totals: activityRows([
						{ completionCount: 1, consumedMinutes: 3.7, unknownDurationCount: 0 },
					]),
					collectionEvents: activityRows([
						{
							id: "collection-added",
							collectionName: "Favourites",
							collectionId: "collection-1",
							createdAt: "2024-02-02T10:00:00.000Z",
							occurredAt: "2024-02-02T09:00:00.000Z",
							eventSchemaSlug: "add-entity-to-collection",
						},
					]),
					musicEvents: activityRows([
						{
							text: null,
							rating: null,
							timeSpent: null,
							isSpoiler: null,
							startedOn: null,
							completedOn: null,
							progressPercent: 42,
							id: "music-progress",
							consumedOn: "Spotify",
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
				consumedMinutes: 3.7,
				unknownDurationCount: 0,
				events: [
					{ kind: "media", progressPercent: 42, id: "music-progress", consumedOn: "Spotify" },
					{ kind: "collection", progressPercent: null, id: "collection-added" },
				],
			},
		});
	});

	it("builds one presentation query for all requested music IDs", () => {
		const recipe = musicPresentationRecipe(["music-2", "music-1"]);
		const music = recipe.document.queries["music"];
		if (music?.output.type !== "rows" || music.where?.type !== "and") {
			throw new Error("Expected a filtered presentation rows query");
		}

		expect(Object.keys(recipe.document.queries)).toEqual(["music"]);
		expect(music.where.predicates[1]).toMatchObject({
			type: "in",
			values: [{ value: "music-2" }, { value: "music-1" }],
		});
		expect(music.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"name",
			"schemaSlug",
			"populationStatus",
			"translationStatus",
			"state",
			"images",
			"duration",
			"progressPercent",
			"publishDate",
			"publishYear",
			"productionStatus",
		]);
	});
});
