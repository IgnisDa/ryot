import type {
	MediaActivityOf,
	MediaPresentationDataOf,
	MediaSummaryOf,
} from "../../shared/media-recipes";
import { podcastRecipes } from "../../shared/podcast-recipes";
import { mediaEpisodicActivityCopy } from "../media/activity-copy";
import {
	mediaEpisodicCoveragePercent,
	type MediaEpisodicCoverage,
} from "../media/episodic-activity-state";
import { defineEpisodicMediaSchema } from "../media/episodic-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaCountFact, mediaCountLabel, type MediaSummaryFact } from "../media/summary-state";
import { PodcastEpisodesTab, podcastEpisodeOriginLabel } from "./episodes";

type PodcastSummary = MediaSummaryOf<typeof podcastRecipes>;

type PodcastPresentation = MediaPresentationDataOf<typeof podcastRecipes>;

export const podcastActivityCoverage = (
	result: MediaActivityOf<typeof podcastRecipes>,
): MediaEpisodicCoverage => {
	const [episodes] = result.coverage;
	if (episodes === undefined) {
		return {
			rows: [],
			minutes: { total: 0, missing: 0 },
			headline: { watched: 0, total: undefined },
		};
	}
	return {
		headline: { total: episodes.episodeTotal, watched: episodes.watchedTotal },
		minutes: { total: episodes.watchedMinutes ?? 0, missing: episodes.watchedUnknownRuntime },
		rows: [
			{
				key: episodes.id,
				label: "Episodes",
				total: episodes.episodeTotal,
				watched: episodes.watchedTotal,
				percent: mediaEpisodicCoveragePercent(episodes.watchedTotal, episodes.episodeTotal),
			},
		],
	};
};

export const podcastSummaryFacts = (podcast: PodcastSummary): readonly MediaSummaryFact[] =>
	[mediaCountFact(podcast.totalEpisodes, "Episode", "podcast")].filter(
		(fact) => fact !== undefined,
	);

export const podcastPresentationFacts = (podcast: PodcastPresentation) =>
	podcast.productionStatus === null ? [] : [podcast.productionStatus];

export const podcastPresentationDetail = (podcast: PodcastPresentation) => {
	if (podcast.storedEpisodes === 0) {
		return undefined;
	}
	return [
		mediaCountLabel(podcast.storedEpisodes, "stored episode"),
		podcast.watchedEpisodes === 0 ? undefined : `${podcast.watchedEpisodes} played`,
		podcast.inProgressEpisodes === 0
			? undefined
			: `${mediaCountLabel(podcast.inProgressEpisodes, "episode")} in progress`,
	]
		.filter((part) => part !== undefined)
		.join(" · ");
};

export const podcastSchema = defineEpisodicMediaSchema({
	aspect: "square",
	typeLabel: "Podcast",
	recipes: podcastRecipes,
	facts: podcastSummaryFacts,
	EpisodesTab: PodcastEpisodesTab,
	coverage: podcastActivityCoverage,
	heroHeight: () => MEDIA_ART_HEIGHT,
	episodeOrigin: podcastEpisodeOriginLabel,
	presentationFacts: podcastPresentationFacts,
	presentationDetail: podcastPresentationDetail,
	nouns: { title: "Podcast", plural: "podcasts", singular: "podcast" },
	overviewLoadingDetail: "Fetching the hosts, networks and recommendations for this podcast.",
	activityCopy: mediaEpisodicActivityCopy({
		verb: "listen",
		noun: "podcast",
		watchedLabel: "Played",
	}),
	creditCopy: {
		people: "Hosts & guests",
		companies: "Networks & publishers",
		notice: "Hosts, networks and recommendations",
	},
});
