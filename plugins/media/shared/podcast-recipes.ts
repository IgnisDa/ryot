import {
	episodicEpisodesRecipe,
	episodicParentCoverageQuery,
	mediaEpisodicRecipes,
} from "./episodic-recipes";
import { podcastEpisodicKindConfig } from "./lifecycle-expressions";
import { mediaUnlinkedCreatorsOverviewQueries } from "./media-recipes";

const PODCAST_EPISODE_RELATIONSHIP = "podcast-to-podcast-episode";

const podcastCoverageQuery = episodicParentCoverageQuery({
	slug: "podcast",
	alias: "podcast",
	episodeSchemaSlug: "podcast-episode",
	relationshipSlug: PODCAST_EPISODE_RELATIONSHIP,
});

export const podcastRecipes = mediaEpisodicRecipes({
	slug: "podcast",
	alias: "podcast",
	orderProperties: [],
	episodeFields: () => ({}),
	summaryFields: () => ({}),
	presentationFields: () => ({}),
	config: podcastEpisodicKindConfig,
	coverageQuery: podcastCoverageQuery,
	extraOverviewQueries: mediaUnlinkedCreatorsOverviewQueries,
	activityEpisode: (row) => ({
		id: row.episodeId,
		name: row.episodeName,
		runtime: row.episodeRuntime,
		episodeNumber: row.episodeNumber,
	}),
});

export const podcastEpisodesRecipe = episodicEpisodesRecipe({
	order: "desc",
	alias: "podcastEpisode",
	extraFields: () => ({}),
	episodeSchemaSlug: "podcast-episode",
	relationshipSlug: PODCAST_EPISODE_RELATIONSHIP,
});
