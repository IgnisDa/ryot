import {
	podcastActivityRecipe,
	podcastOverviewRecipe,
	podcastPresentationRecipe,
	podcastSummaryRecipe,
	type PodcastActivityResult,
	type PodcastPresentationData,
	type PodcastSummaryResult,
} from "../../shared/podcast-recipes";
import {
	mediaEpisodicCoveragePercent,
	type MediaEpisodicCoverage,
} from "../media/episodic-activity-state";
import { defineEpisodicMediaSchema } from "../media/episodic-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import {
	mediaCountFact,
	mediaCountLabel,
	mediaRatingFact,
	type MediaSummaryFact,
} from "../media/summary-state";
import { PodcastEpisodesTab, podcastEpisodeOriginLabel } from "./episodes";

type PodcastSummary = NonNullable<PodcastSummaryResult["summary"]>;

export const podcastActivityCoverage = (result: PodcastActivityResult): MediaEpisodicCoverage => {
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

export const podcastSummaryFacts = (podcast: PodcastSummary): readonly MediaSummaryFact[] => {
	const episodes = mediaCountFact(podcast.totalEpisodes, "Episode");
	return [
		mediaRatingFact(podcast),
		episodes === undefined ? undefined : { icon: "podcast", ...episodes },
		podcast.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: podcast.productionStatus },
	].filter((fact) => fact !== undefined);
};

export const podcastPresentationFacts = (podcast: PodcastPresentationData) =>
	podcast.productionStatus === null ? [] : [podcast.productionStatus];

export const podcastPresentationDetail = (podcast: PodcastPresentationData) => {
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
	facts: podcastSummaryFacts,
	EpisodesTab: PodcastEpisodesTab,
	coverage: podcastActivityCoverage,
	heroHeight: () => MEDIA_ART_HEIGHT,
	episodeOrigin: podcastEpisodeOriginLabel,
	presentationFacts: podcastPresentationFacts,
	presentationDetail: podcastPresentationDetail,
	nouns: { title: "Podcast", plural: "podcasts", singular: "podcast" },
	unlinkedCreators: (overview) => overview.creators?.unlinkedCreators ?? [],
	overviewLoadingDetail: "Fetching the hosts, networks and recommendations for this podcast.",
	creditCopy: {
		people: "Hosts & guests",
		companies: "Networks & publishers",
		notice: "Hosts, networks and recommendations",
	},
	recipes: {
		summaryRecipe: podcastSummaryRecipe,
		overviewRecipe: podcastOverviewRecipe,
		activityRecipe: podcastActivityRecipe,
		presentationRecipe: podcastPresentationRecipe,
	},
	activityCopy: {
		segmentNoun: "Listen",
		recordLabel: "Listen record",
		figures: { time: "Time", watches: "Listens", episodes: "Episodes" },
		loadingDetail: "Fetching everything you have recorded for this podcast.",
		rowLabels: {
			watched: "Played",
			review: "Reviewed the podcast",
			completion: "Finished the podcast",
		},
		beats: {
			backlog: "Added to backlog",
			dropped: "Stopped listening",
			on_hold: "Put this podcast on hold",
		},
		emptyDetail:
			"Nothing has been recorded for this podcast. Whatever you listen to will appear here as your listen record.",
	},
});
