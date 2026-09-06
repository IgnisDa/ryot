import type { Recipe } from "@ryot-app/plugin-kit/ryotql";

import {
	episodicEpisodesRecipe,
	episodicParentCoverageQuery,
	mediaEpisodicRecipes,
} from "../../../shared/episodic-recipes";
import { podcastEpisodicKindConfig } from "../../../shared/lifecycle-expressions";

const EPISODE_RELATIONSHIP = "podcast-to-podcast-episode";

export const episodicFixtureRecipes = mediaEpisodicRecipes({
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
		relationshipSlug: EPISODE_RELATIONSHIP,
	}),
});

export const episodicFixtureEpisodesRecipe = episodicEpisodesRecipe({
	order: "desc",
	alias: "fixtureEpisode",
	extraFields: () => ({}),
	episodeSchemaSlug: "podcast-episode",
	relationshipSlug: EPISODE_RELATIONSHIP,
});

export type EpisodicFixtureSummaryResult = Recipe.Success<
	typeof episodicFixtureRecipes.summaryRecipe
>;
export type EpisodicFixtureActivityResult = Recipe.Success<
	typeof episodicFixtureRecipes.activityRecipe
>;
export type EpisodicFixtureOverviewResult = Recipe.Success<
	typeof episodicFixtureRecipes.overviewRecipe
>;
export type EpisodicFixturePresentationData = Recipe.Success<
	typeof episodicFixtureRecipes.presentationRecipe
>[number];
export type EpisodicFixtureEpisode = Recipe.Success<
	typeof episodicFixtureEpisodesRecipe
>["items"][number];
