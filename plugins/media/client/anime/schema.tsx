import { formatDateLabel } from "@ryot-app/plugin-ui-sdk/datetime";

import { animeRecipes } from "../../shared/anime-recipes";
import type {
	MediaActivityEventOf,
	MediaPresentationDataOf,
	MediaSummaryOf,
} from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { mediaFlatActivityCopy, mediaListStateDetail } from "../media/activity-copy";
import { mediaActivityCountFigure } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { mediaCountFact, mediaCountLabels, type MediaSummaryFact } from "../media/summary-state";
import type { MediaCopy } from "../messages";
import { mediaSchemaAspects } from "../schema-aspects";
import { animeAiringTrailing, animeUpcomingEpisodes } from "./sections";

type AnimeSummary = MediaSummaryOf<typeof animeRecipes>;

type AnimePresentation = MediaPresentationDataOf<typeof animeRecipes>;

type AnimeListStateSnapshot = Pick<
	Extract<MediaActivityEventOf<typeof animeRecipes>, { readonly kind: "media" }>,
	"listState"
>;

export const animeSummaryFacts = (
	anime: AnimeSummary,
	{ text, formatters }: MediaCopy,
): readonly MediaSummaryFact[] => {
	const [next] = animeUpcomingEpisodes(anime.airingSchedule);
	return [
		next === undefined
			? undefined
			: {
					icon: "clock",
					label: text("fact.next-episode"),
					value: formatDateLabel(formatters, next.airingAt),
				},
		mediaCountFact(text, anime.episodes, "episode", "tv"),
	].filter((fact) => fact !== undefined);
};

export const animePresentationFacts = (anime: AnimePresentation, { text }: MediaCopy) =>
	mediaCountLabels(text, anime.episodes, "episode");

export const animeSchema = defineFlatMediaSchema({
	recipes: animeRecipes,
	facts: animeSummaryFacts,
	aspect: mediaSchemaAspects.anime,
	overviewTrailing: animeAiringTrailing,
	presentationFacts: animePresentationFacts,
	overviewLoadingDetail: catalogMessage("overview.loading.anime"),
	measureFigure: { value: mediaActivityCountFigure, label: catalogMessage("property.episodes") },
	logActivity: {
		units: ["episodes"],
		family: "positional",
		copy: { verb: "watch", kind: "anime" },
	},
	creditCopy: {
		people: catalogMessage("credits.cast-crew"),
		companies: catalogMessage("credits.studios"),
		notice: catalogMessage("credits.notice.anime"),
	},
	activityCopy: (copy) =>
		mediaFlatActivityCopy<AnimeListStateSnapshot>(copy, {
			verb: "watch",
			kind: "anime",
			snapshot: { source: "anilist", detail: mediaListStateDetail },
		}),
});
