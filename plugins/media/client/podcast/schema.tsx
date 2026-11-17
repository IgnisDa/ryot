import type {
	MediaActivityOf,
	MediaPresentationDataOf,
	MediaSummaryOf,
} from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { podcastRecipes } from "../../shared/podcast-recipes";
import { mediaEpisodicActivityCopy } from "../media/activity-copy";
import {
	type MediaEpisodicCoverage,
	mediaEpisodicCoveragePercent,
} from "../media/episodic-activity-state";
import { defineEpisodicMediaSchema } from "../media/episodic-schema";
import { mediaCountFact, mediaCountLabel, type MediaSummaryFact } from "../media/summary-state";
import type { MediaCopy } from "../messages";
import { mediaSchemaAspects } from "../schema-aspects";
import { podcastEpisodeOriginLabel, PodcastEpisodesTab } from "./episodes";

type PodcastSummary = MediaSummaryOf<typeof podcastRecipes>;

type PodcastPresentation = MediaPresentationDataOf<typeof podcastRecipes>;

export const podcastActivityCoverage = (
	result: MediaActivityOf<typeof podcastRecipes>,
): MediaEpisodicCoverage => {
	const [episodes] = result.coverage;
	if (episodes === undefined) {
		return { rows: [], headline: { watched: 0, total: undefined } };
	}
	return {
		headline: { total: episodes.episodeTotal, watched: episodes.watchedTotal },
		rows: [
			{
				key: episodes.id,
				total: episodes.episodeTotal,
				watched: episodes.watchedTotal,
				label: catalogMessage("property.episodes"),
				percent: mediaEpisodicCoveragePercent(episodes.watchedTotal, episodes.episodeTotal),
			},
		],
	};
};

export const podcastSummaryFacts = (
	podcast: PodcastSummary,
	{ text }: MediaCopy,
): readonly MediaSummaryFact[] =>
	[mediaCountFact(text, podcast.totalEpisodes, "episode", "podcast")].filter(
		(fact) => fact !== undefined,
	);

export const podcastPresentationFacts = (podcast: PodcastPresentation) =>
	podcast.productionStatus === null ? [] : [podcast.productionStatus];

export const podcastPresentationDetail = (podcast: PodcastPresentation, { text }: MediaCopy) => {
	if (podcast.airedEpisodes === 0) {
		return undefined;
	}
	return [
		mediaCountLabel(text, podcast.airedEpisodes, "aired_episode"),
		podcast.watchedEpisodes === 0
			? undefined
			: text("podcast.played", { count: podcast.watchedEpisodes }),
		podcast.inProgressEpisodes === 0
			? undefined
			: text("count.in-progress", { count: podcast.inProgressEpisodes }),
	]
		.filter((part) => part !== undefined)
		.join(" · ");
};

export const podcastSchema = defineEpisodicMediaSchema({
	recipes: podcastRecipes,
	facts: podcastSummaryFacts,
	EpisodesTab: PodcastEpisodesTab,
	coverage: podcastActivityCoverage,
	aspect: mediaSchemaAspects.podcast,
	episodeOrigin: podcastEpisodeOriginLabel,
	presentationFacts: podcastPresentationFacts,
	presentationDetail: podcastPresentationDetail,
	episodeOrder: (episode) => [episode.episodeNumber],
	overviewLoadingDetail: catalogMessage("overview.loading.podcast"),
	logActivity: { family: "podcast", copy: { verb: "listen", kind: "podcast" } },
	activityCopy: (copy) =>
		mediaEpisodicActivityCopy(copy.text, { verb: "listen", kind: "podcast", watched: "played" }),
	creditCopy: {
		people: catalogMessage("credits.hosts-guests"),
		notice: catalogMessage("credits.notice.podcast"),
		companies: catalogMessage("credits.networks-publishers"),
	},
});
