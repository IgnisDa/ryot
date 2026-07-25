import type {
	MediaActivityOf,
	MediaPresentationDataOf,
	MediaSummaryOf,
} from "../../shared/media-recipes";
import { showRecipes } from "../../shared/show-recipes";
import { mediaEpisodicActivityCopy } from "../media/activity-copy";
import {
	mediaEpisodicCoveragePercent,
	type MediaEpisodicCoverage,
} from "../media/episodic-activity-state";
import { defineEpisodicMediaSchema } from "../media/episodic-schema";
import { MEDIA_ART_HEIGHT, MEDIA_BACKDROP_HEIGHT } from "../media/hero";
import { mediaWatchProvidersTrailing } from "../media/overview";
import { mediaCountFact, mediaCountLabel, type MediaSummaryFact } from "../media/summary-state";
import { mediaSchemaAspects } from "../schema-aspects";
import { ShowEpisodesTab } from "./episodes";
import {
	isSpecialsSeason,
	seasonOrder,
	showEpisodeOriginLabel,
	showSeasonOriginLabel,
} from "./episodes-state";

type ShowSummary = MediaSummaryOf<typeof showRecipes>;

type ShowActivity = MediaActivityOf<typeof showRecipes>;

type ShowPresentation = MediaPresentationDataOf<typeof showRecipes>;

type ShowCoverageRow = ShowActivity["coverage"][number];

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

export const showActivityCoverage = (result: ShowActivity): MediaEpisodicCoverage => {
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

export const showSummaryFacts = (show: ShowSummary): readonly MediaSummaryFact[] =>
	[
		mediaCountFact(show.totalSeasons, "Season", "layers-3"),
		mediaCountFact(show.totalEpisodes, "Episode", "tv"),
	].filter((fact) => fact !== undefined);

export const showPresentationFacts = (show: ShowPresentation) =>
	show.productionStatus === null ? [] : [show.productionStatus];

const episodeProgressLabel = (show: ShowPresentation) => {
	if (show.storedEpisodes === 0) {
		return undefined;
	}
	if (show.watchedEpisodes === 0) {
		return mediaCountLabel(show.storedEpisodes, "stored episode");
	}
	return `${show.watchedEpisodes} of ${show.storedEpisodes} episodes watched`;
};

export const showPresentationDetail = (show: ShowPresentation) => {
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
	typeLabel: "TV Show",
	recipes: showRecipes,
	facts: showSummaryFacts,
	EpisodesTab: ShowEpisodesTab,
	coverage: showActivityCoverage,
	aspect: mediaSchemaAspects.show,
	episodeOrigin: showEpisodeOriginLabel,
	presentationFacts: showPresentationFacts,
	presentationDetail: showPresentationDetail,
	nouns: { title: "Show", plural: "shows", singular: "show" },
	overviewTrailing: mediaWatchProvidersTrailing((summary) => summary),
	heroHeight: (compact) => (compact ? MEDIA_ART_HEIGHT : MEDIA_BACKDROP_HEIGHT),
	overviewLoadingDetail: "Fetching the cast, companies and recommendations for this show.",
	activityCopy: mediaEpisodicActivityCopy({ noun: "show", verb: "watch", watchedLabel: "Watched" }),
	creditCopy: {
		people: "Cast & crew",
		companies: "Production companies",
		notice: "Cast, companies and recommendations",
	},
});
