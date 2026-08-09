import {
	mangaActivityRecipe,
	mangaOverviewRecipe,
	mangaPresentationRecipe,
	mangaSummaryRecipe,
	type MangaActivityEvent,
	type MangaPresentationData,
	type MangaSummaryResult,
} from "../../shared/manga-recipes";
import { decimalLabel, mediaActivityCountFigure } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaCountLabel, mediaRatingFact, type MediaSummaryFact } from "../media/summary-state";

type MangaSummary = NonNullable<MangaSummaryResult["summary"]>;

type MangaProgressPosition = Pick<
	Extract<MangaActivityEvent, { readonly kind: "media" }>,
	"mangaChapter" | "mangaVolume"
>;

export const mangaSummaryFacts = (manga: MangaSummary): readonly MediaSummaryFact[] =>
	[
		mediaRatingFact(manga),
		manga.chapters === null
			? undefined
			: { icon: "book-open", label: "Chapters", value: `${manga.chapters}` },
		manga.volumes === null
			? undefined
			: { icon: "layers", label: "Volumes", value: `${manga.volumes}` },
		manga.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: manga.productionStatus },
	].filter((fact) => fact !== undefined);

export const mangaPresentationFacts = (manga: MangaPresentationData) =>
	manga.chapters === null ? [] : [mediaCountLabel(manga.chapters, "chapter")];

export const mangaProgressLabel = (
	percent: string | undefined,
	position: MangaProgressPosition,
): string => {
	const volume = position.mangaVolume === null ? undefined : `Volume ${position.mangaVolume}`;
	const chapter =
		position.mangaChapter === null ? undefined : `Chapter ${decimalLabel(position.mangaChapter)}`;
	if (volume !== undefined && chapter !== undefined) {
		return `${volume}, ${chapter}`;
	}
	if (chapter !== undefined) {
		return chapter;
	}
	if (volume !== undefined) {
		return volume;
	}
	return percent === undefined ? "Part-way through the manga" : `${percent}% through the manga`;
};

export const mangaSchema = defineFlatMediaSchema({
	aspect: "poster",
	progressVerb: "read",
	facts: mangaSummaryFacts,
	heroHeight: () => MEDIA_ART_HEIGHT,
	presentationFacts: mangaPresentationFacts,
	nouns: { title: "Manga", plural: "manga", singular: "manga" },
	measureFigure: { label: "Chapters", value: mediaActivityCountFigure },
	overviewLoadingDetail: "Fetching the credits and recommendations for this manga.",
	creditCopy: {
		companies: "Publishers",
		people: "Authors & artists",
		notice: "Credits and recommendations",
	},
	recipes: {
		summaryRecipe: mangaSummaryRecipe,
		overviewRecipe: mangaOverviewRecipe,
		activityRecipe: mangaActivityRecipe,
		presentationRecipe: mangaPresentationRecipe,
	},
	activityCopy: {
		segmentNoun: "Read",
		completionsLabel: "Reads",
		recordLabel: "Reading record",
		loadingDetail: "Fetching everything you have recorded for this manga.",
		beats: { dropped: "Stopped reading", on_hold: "Put this manga on hold" },
		emptyDetail:
			"Nothing has been recorded for this manga. Whatever you read will appear here as your reading record.",
		rowLabels: {
			progress: mangaProgressLabel,
			review: "Reviewed the manga",
			completion: "Finished the manga",
		},
	},
});
