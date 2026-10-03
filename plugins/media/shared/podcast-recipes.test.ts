import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { podcastEpisodesRecipe, podcastRecipes } from "./podcast-recipes";

const rows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

const PODCAST_EPISODE_ROW = {
	runtime: 52,
	id: "episode-9",
	episodeNumber: 9,
	state: "untracked",
	name: "The Interview",
	publishDate: "2025-03-13",
	populationStatus: "ready",
	translationStatus: "none",
	schemaSlug: "podcast-episode",
	description: "A long conversation.",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/episode-9.jpg" }],
};

describe("media podcast query recipes", () => {
	it("lists podcast episodes newest first as a cursor-paged row query", () => {
		const recipe = podcastEpisodesRecipe({ limit: 40, containerId: "podcast-1" });
		const episodes = recipe.document.queries["episodes"];
		if (episodes?.output.type !== "rows" || episodes.where?.type !== "and") {
			throw new Error("Expected a filtered episode rows query");
		}

		expect(Object.keys(recipe.document.queries)).toEqual(["episodes"]);
		expect(episodes.output.pagination).toEqual({ limit: 40 });
		expect(episodes.output.orderBy.map(({ direction }) => direction)).toEqual(["desc", "desc"]);
		expect(episodes.where.predicates[1]).toMatchObject({
			type: "comparison",
			right: { type: "literal", value: "podcast-1" },
		});
		expect(episodes.where.predicates[2]).toMatchObject({
			type: "comparison",
			right: { type: "literal", value: "podcast-to-podcast-episode" },
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
		]);
	});

	it("resumes an episode list from the cursor the previous page handed back", () => {
		const recipe = podcastEpisodesRecipe({
			limit: 40,
			after: "cursor-1",
			containerId: "podcast-1",
		});
		const episodes = recipe.document.queries["episodes"];
		if (episodes?.output.type !== "rows") {
			throw new Error("Expected an episode rows query");
		}

		expect(episodes.output.pagination).toEqual({ limit: 40, after: "cursor-1" });
		expect(
			recipe.decode({
				data: {
					episodes: rowsResult([PODCAST_EPISODE_ROW], {
						limit: 40,
						hasMore: true,
						nextCursor: "cursor-2",
					}),
				},
			}),
		).toMatchObject({
			success: {
				pageInfo: { nextCursor: "cursor-2" },
				items: [{ id: "episode-9", state: "untracked" }],
			},
		});
	});

	it("covers every episode hanging off the podcast in one row", () => {
		const recipe = podcastRecipes.summaryRecipe({ collectionLimit: 6, entityId: "podcast-1" });
		const summary = recipe.document.queries["summary"];
		if (summary?.output.type !== "rows") {
			throw new Error("Expected a summary rows query");
		}

		expect(summary.output.fields.map((field) => ("key" in field ? field.key : null))).toContain(
			"totalEpisodes",
		);
		expect(JSON.stringify(summary)).toContain("podcast-to-podcast-episode");
		expect(JSON.stringify(summary)).not.toContain("watchProviders");
	});

	it("adds the podcast's unlinked creators to the overview queries", () => {
		const recipe = podcastRecipes.overviewRecipe({
			peopleLimit: 12,
			companyLimit: 6,
			entityId: "podcast-1",
			recommendationLimit: 12,
		});

		expect(Object.keys(recipe.document.queries)).toEqual([
			"companies",
			"people",
			"recommendations",
			"creators",
		]);
		expect(
			recipe.decode({
				data: {
					people: rows([]),
					companies: rows([]),
					recommendations: rows([]),
					creators: rows([{ unlinkedCreators: [{ role: "Publisher", name: "Acme Media" }] }]),
				},
			}),
		).toMatchObject({
			success: { creators: { unlinkedCreators: [{ role: "Publisher", name: "Acme Media" }] } },
		});
	});

	it("builds one presentation query carrying the podcast's episode counts", () => {
		const recipe = podcastRecipes.presentationRecipe(["podcast-2", "podcast-1"]);
		const podcasts = recipe.document.queries["rows"];
		if (podcasts?.output.type !== "rows" || podcasts.where?.type !== "and") {
			throw new Error("Expected a filtered presentation rows query");
		}

		expect(podcasts.where.predicates[1]).toMatchObject({
			type: "in",
			values: [{ value: "podcast-2" }, { value: "podcast-1" }],
		});
		expect(podcasts.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
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
			"airedEpisodes",
			"watchedEpisodes",
			"upcomingEpisodes",
			"inProgressEpisodes",
		]);
	});
});
