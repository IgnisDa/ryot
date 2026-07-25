import { defineRecipe, type Recipe } from "@ryot-app/plugin-kit/ryotql";

import {
	episodicEpisodesRecipe,
	episodicParentCoverageQuery,
	mediaEpisodicRecipes,
	type EpisodicOverviewInput,
} from "./episodic-recipes";
import { podcastEpisodicKindConfig } from "./lifecycle-expressions";
import { mediaUnlinkedCreatorsQuery } from "./media-recipes";

const PODCAST_EPISODE_RELATIONSHIP = "podcast-to-podcast-episode";

const podcastCoverageQuery = episodicParentCoverageQuery({
	slug: "podcast",
	alias: "podcast",
	episodeSchemaSlug: "podcast-episode",
	relationshipSlug: PODCAST_EPISODE_RELATIONSHIP,
});

const podcastRecipes = mediaEpisodicRecipes({
	slug: "podcast",
	alias: "podcast",
	orderProperties: [],
	episodeFields: () => ({}),
	summaryFields: () => ({}),
	presentationFields: () => ({}),
	config: podcastEpisodicKindConfig,
	coverageQuery: podcastCoverageQuery,
	activityEpisode: (row) => ({
		id: row.episodeId,
		name: row.episodeName,
		runtime: row.episodeRuntime,
		episodeNumber: row.episodeNumber,
	}),
});

export const {
	summaryRecipe: podcastSummaryRecipe,
	activityRecipe: podcastActivityRecipe,
	presentationRecipe: podcastPresentationRecipe,
} = podcastRecipes;

export const podcastEpisodesRecipe = episodicEpisodesRecipe({
	order: "desc",
	alias: "podcastEpisode",
	extraFields: () => ({}),
	episodeSchemaSlug: "podcast-episode",
	relationshipSlug: PODCAST_EPISODE_RELATIONSHIP,
});

export const podcastOverviewRecipe = defineRecipe((input: EpisodicOverviewInput) => ({
	queries: {
		...podcastRecipes.overviewQueries(input),
		creators: mediaUnlinkedCreatorsQuery(input.entityId),
	},
}));

export type PodcastActivityEvent = PodcastActivityResult["events"][number];
export type PodcastSummaryResult = Recipe.Success<typeof podcastSummaryRecipe>;
export type PodcastActivityResult = Recipe.Success<typeof podcastActivityRecipe>;
export type PodcastOverviewResult = Recipe.Success<typeof podcastOverviewRecipe>;
export type PodcastEpisodesResult = Recipe.Success<typeof podcastEpisodesRecipe>;
export type PodcastPresentationData = Recipe.Success<typeof podcastPresentationRecipe>[number];
