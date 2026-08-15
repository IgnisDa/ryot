import { animeRecipes } from "../../shared/anime-recipes";
import type {
	MediaActivityEventOf,
	MediaPresentationDataOf,
	MediaSummaryOf,
} from "../../shared/media-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityCountFigure } from "../media/activity-timeline";
import { formatLocalDateLabel } from "../media/date";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaCountFact, mediaCountLabels, type MediaSummaryFact } from "../media/summary-state";
import { mediaSchemaAspects } from "../schema-aspects";
import { animeAiringTrailing, animeUpcomingEpisodes } from "./sections";

type AnimeSummary = MediaSummaryOf<typeof animeRecipes>;

type AnimePresentation = MediaPresentationDataOf<typeof animeRecipes>;

type AnimeProgressPosition = Pick<
	Extract<MediaActivityEventOf<typeof animeRecipes>, { readonly kind: "media" }>,
	"animeEpisode"
>;

export const animeSummaryFacts = (anime: AnimeSummary): readonly MediaSummaryFact[] => {
	const [next] = animeUpcomingEpisodes(anime.airingSchedule);
	return [
		next === undefined
			? undefined
			: { icon: "clock", label: "Next episode", value: formatLocalDateLabel(next.airingAt) },
		mediaCountFact(anime.episodes, "Episode", "tv"),
	].filter((fact) => fact !== undefined);
};

export const animePresentationFacts = (anime: AnimePresentation) =>
	mediaCountLabels(anime.episodes, "episode");

export const animeProgressLabel = (
	percent: string | undefined,
	position: AnimeProgressPosition,
): string => {
	if (position.animeEpisode !== null) {
		return `Episode ${position.animeEpisode}`;
	}
	return percent === undefined ? "Part-way through the anime" : `${percent}% through the anime`;
};

export const animeSchema = defineFlatMediaSchema({
	recipes: animeRecipes,
	facts: animeSummaryFacts,
	aspect: mediaSchemaAspects.anime,
	heroHeight: () => MEDIA_ART_HEIGHT,
	overviewTrailing: animeAiringTrailing,
	presentationFacts: animePresentationFacts,
	nouns: { title: "Anime", plural: "anime", singular: "anime" },
	measureFigure: { label: "Episodes", value: mediaActivityCountFigure },
	overviewLoadingDetail: "Fetching the studios and recommendations for this anime.",
	creditCopy: {
		companies: "Studios",
		people: "Cast & crew",
		notice: "Studios and recommendations",
	},
	activityCopy: mediaFlatActivityCopy({
		verb: "watch",
		noun: "anime",
		progress: animeProgressLabel,
	}),
});
