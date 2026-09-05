import {
	showActivityRecipe,
	showOverviewRecipe,
	showPresentationRecipe,
	showSummaryRecipe,
	type ShowActivityResult,
	type ShowPresentationData,
	type ShowSummaryResult,
} from "../../shared/show-recipes";
import {
	mediaEpisodicCoveragePercent,
	type MediaEpisodicCoverage,
} from "../media/episodic-activity-state";
import { defineEpisodicMediaSchema } from "../media/episodic-schema";
import { MEDIA_ART_HEIGHT, MEDIA_BACKDROP_HEIGHT } from "../media/hero";
import { mediaWatchProvidersTrailing } from "../media/overview";
import {
	mediaCountFact,
	mediaCountLabel,
	mediaRatingFact,
	type MediaSummaryFact,
} from "../media/summary-state";
import { ShowEpisodesTab } from "./episodes";
import {
	isSpecialsSeason,
	seasonOrder,
	showEpisodeOriginLabel,
	showSeasonOriginLabel,
} from "./episodes-state";

type ShowSummary = NonNullable<ShowSummaryResult["summary"]>;

type ShowCoverageRow = ShowActivityResult["coverage"][number];

const seasonCoverageRow = (season: ShowCoverageRow) => ({
	key: season.id,
	total: season.episodeTotal,
	watched: season.watchedTotal,
	label: showSeasonOriginLabel(season),
	percent: mediaEpisodicCoveragePercent(season.watchedTotal, season.episodeTotal),
});

const watchedMinutes = (seasons: readonly ShowCoverageRow[]) =>
	seasons.reduce(
		(totals, season) => ({
			total: totals.total + (season.watchedMinutes ?? 0),
			missing: totals.missing + season.watchedUnknownRuntime,
		}),
		{ total: 0, missing: 0 },
	);

export const showActivityCoverage = (result: ShowActivityResult): MediaEpisodicCoverage => {
	const ordered = [...result.coverage].sort(
		(left, right) => seasonOrder(left) - seasonOrder(right),
	);
	const regular = ordered.filter((season) => !isSpecialsSeason(season));
	return {
		rows: ordered.map(seasonCoverageRow),
		minutes: watchedMinutes(result.coverage),
		headline: {
			watched: regular.reduce((total, season) => total + season.watchedTotal, 0),
			total:
				regular.length === 0
					? undefined
					: regular.reduce((total, season) => total + season.episodeTotal, 0),
		},
	};
};

export const showSummaryFacts = (show: ShowSummary): readonly MediaSummaryFact[] => {
	const seasons = mediaCountFact(show.totalSeasons, "Season");
	const episodes = mediaCountFact(show.totalEpisodes, "Episode");
	return [
		mediaRatingFact(show),
		show.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: show.productionStatus },
		seasons === undefined ? undefined : { icon: "layers-3", ...seasons },
		episodes === undefined ? undefined : { icon: "tv", ...episodes },
	].filter((fact) => fact !== undefined);
};

export const showPresentationFacts = (show: ShowPresentationData) =>
	show.productionStatus === null ? [] : [show.productionStatus];

const episodeProgressLabel = (show: ShowPresentationData) => {
	if (show.storedEpisodes === 0) {
		return undefined;
	}
	if (show.watchedEpisodes === 0) {
		return mediaCountLabel(show.storedEpisodes, "stored episode");
	}
	return `${show.watchedEpisodes} of ${show.storedEpisodes} episodes watched`;
};

export const showPresentationDetail = (show: ShowPresentationData) => {
	const progress = episodeProgressLabel(show);
	if (show.storedSeasons === 0 && progress === undefined) {
		return undefined;
	}
	return [
		show.storedSeasons === 0 ? undefined : mediaCountLabel(show.storedSeasons, "stored season"),
		progress,
		show.inProgressEpisodes === 0
			? undefined
			: `${mediaCountLabel(show.inProgressEpisodes, "episode")} in progress`,
	]
		.filter((part) => part !== undefined)
		.join(" · ");
};

export const showSchema = defineEpisodicMediaSchema({
	aspect: "poster",
	typeLabel: "TV Show",
	facts: showSummaryFacts,
	EpisodesTab: ShowEpisodesTab,
	coverage: showActivityCoverage,
	episodeOrigin: showEpisodeOriginLabel,
	presentationFacts: showPresentationFacts,
	presentationDetail: showPresentationDetail,
	nouns: { title: "Show", plural: "shows", singular: "show" },
	overviewTrailing: mediaWatchProvidersTrailing((summary) => summary),
	heroHeight: (compact) => (compact ? MEDIA_ART_HEIGHT : MEDIA_BACKDROP_HEIGHT),
	overviewLoadingDetail: "Fetching the cast, companies and recommendations for this show.",
	creditCopy: {
		people: "Cast & crew",
		companies: "Production companies",
		notice: "Cast, companies and recommendations",
	},
	recipes: {
		summaryRecipe: showSummaryRecipe,
		overviewRecipe: showOverviewRecipe,
		activityRecipe: showActivityRecipe,
		presentationRecipe: showPresentationRecipe,
	},
	activityCopy: {
		segmentNoun: "Watch",
		recordLabel: "Watch record",
		figures: { time: "Time", watches: "Watches", episodes: "Episodes" },
		loadingDetail: "Fetching everything you have recorded for this show.",
		rowLabels: { watched: "Watched", review: "Reviewed the show", completion: "Finished the show" },
		beats: {
			backlog: "Added to backlog",
			dropped: "Stopped watching",
			on_hold: "Put this show on hold",
		},
		emptyDetail:
			"Nothing has been recorded for this show. Whatever you watch will appear here as your watch record.",
	},
});
