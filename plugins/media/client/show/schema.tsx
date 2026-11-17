import type {
	MediaActivityOf,
	MediaPresentationDataOf,
	MediaSummaryOf,
} from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { originalLanguageFact } from "../../shared/original-language";
import { showRecipes } from "../../shared/show-recipes";
import { mediaEpisodicActivityCopy } from "../media/activity-copy";
import { seasonMessage } from "../media/activity-log/state";
import {
	type MediaEpisodicCoverage,
	mediaEpisodicCoveragePercent,
} from "../media/episodic-activity-state";
import { defineEpisodicMediaSchema } from "../media/episodic-schema";
import { mediaWatchProvidersTrailing } from "../media/overview";
import { mediaCountFact, mediaCountLabel, type MediaSummaryFact } from "../media/summary-state";
import type { MediaCopy, MediaText } from "../messages";
import { mediaSchemaAspects } from "../schema-aspects";
import { ShowEpisodesTab } from "./episodes";
import { isSpecialsSeason, seasonOrder, showEpisodeOriginLabel } from "./episodes-state";

type ShowSummary = MediaSummaryOf<typeof showRecipes>;

type ShowActivity = MediaActivityOf<typeof showRecipes>;

type ShowCoverageRow = ShowActivity["coverage"][number];

type ShowPresentation = MediaPresentationDataOf<typeof showRecipes>;

const seasonCoverageRow = (season: ShowCoverageRow) => ({
	key: season.id,
	total: season.episodeTotal,
	watched: season.watchedTotal,
	label: seasonMessage(season.seasonNumber),
	percent: mediaEpisodicCoveragePercent(season.watchedTotal, season.episodeTotal),
});

export const showActivityCoverage = (result: ShowActivity): MediaEpisodicCoverage => {
	const ordered = [...result.coverage].sort(
		(left, right) => seasonOrder(left) - seasonOrder(right),
	);
	const regular = ordered.filter((season) => !isSpecialsSeason(season));
	return {
		rows: ordered.map(seasonCoverageRow),
		headline: {
			watched: regular.reduce((total, season) => total + season.watchedTotal, 0),
			total:
				regular.length === 0
					? undefined
					: regular.reduce((total, season) => total + season.episodeTotal, 0),
		},
	};
};

export const showSummaryFacts = (
	show: ShowSummary,
	{ text }: MediaCopy,
): readonly MediaSummaryFact[] =>
	[
		...originalLanguageFact(text("property.original-language"), show.originalLanguage),
		mediaCountFact(text, show.totalSeasons, "season", "layers-3"),
		mediaCountFact(text, show.totalEpisodes, "episode", "tv"),
	].filter((fact) => fact !== undefined);

export const showPresentationFacts = (show: ShowPresentation) =>
	show.productionStatus === null ? [] : [show.productionStatus];

const episodeProgressLabel = (text: MediaText, show: ShowPresentation) => {
	if (show.airedEpisodes === 0) {
		return undefined;
	}
	if (show.watchedEpisodes === 0) {
		return mediaCountLabel(text, show.airedEpisodes, "aired_episode");
	}
	return text("show.aired-watched", { aired: show.airedEpisodes, watched: show.watchedEpisodes });
};

export const showPresentationDetail = (show: ShowPresentation, { text }: MediaCopy) => {
	const progress = episodeProgressLabel(text, show);
	if (show.storedSeasons === 0 && progress === undefined) {
		return undefined;
	}
	return [
		show.storedSeasons === 0
			? undefined
			: mediaCountLabel(text, show.storedSeasons, "stored_season"),
		progress,
		show.inProgressEpisodes === 0
			? undefined
			: text("count.in-progress", { count: show.inProgressEpisodes }),
	]
		.filter((part) => part !== undefined)
		.join(" · ");
};

export const showSchema = defineEpisodicMediaSchema({
	recipes: showRecipes,
	facts: showSummaryFacts,
	EpisodesTab: ShowEpisodesTab,
	coverage: showActivityCoverage,
	aspect: mediaSchemaAspects.show,
	episodeOrigin: showEpisodeOriginLabel,
	presentationFacts: showPresentationFacts,
	presentationDetail: showPresentationDetail,
	overviewLoadingDetail: catalogMessage("overview.loading.show"),
	overviewTrailing: mediaWatchProvidersTrailing((summary) => summary),
	logActivity: { family: "show", copy: { kind: "show", verb: "watch" } },
	activityCopy: (copy) =>
		mediaEpisodicActivityCopy(copy.text, { kind: "show", verb: "watch", watched: "watched" }),
	episodeOrder: (episode) => [
		isSpecialsSeason(episode) ? 1 : 0,
		episode.seasonNumber,
		episode.episodeNumber,
	],
	creditCopy: {
		people: catalogMessage("credits.cast-crew"),
		notice: catalogMessage("credits.notice.movie"),
		companies: catalogMessage("credits.production-companies"),
	},
});
