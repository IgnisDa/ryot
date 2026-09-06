import { mangaRecipes } from "../../shared/manga-recipes";
import type {
	MediaActivityEventOf,
	MediaPresentationDataOf,
	MediaSummaryOf,
} from "../../shared/media-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { decimalLabel, mediaActivityCountFigure } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaCountFact, mediaCountLabels, type MediaSummaryFact } from "../media/summary-state";

type MangaSummary = MediaSummaryOf<typeof mangaRecipes>;

type MangaPresentation = MediaPresentationDataOf<typeof mangaRecipes>;

type MangaProgressPosition = Pick<
	Extract<MediaActivityEventOf<typeof mangaRecipes>, { readonly kind: "media" }>,
	"mangaChapter" | "mangaVolume"
>;

export const mangaSummaryFacts = (manga: MangaSummary): readonly MediaSummaryFact[] =>
	[
		mediaCountFact(manga.chapters, "Chapter", "book-open"),
		mediaCountFact(manga.volumes, "Volume", "layers"),
	].filter((fact) => fact !== undefined);

export const mangaPresentationFacts = (manga: MangaPresentation) =>
	mediaCountLabels(manga.chapters, "chapter");

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
	recipes: mangaRecipes,
	facts: mangaSummaryFacts,
	heroHeight: () => MEDIA_ART_HEIGHT,
	presentationFacts: mangaPresentationFacts,
	nouns: { title: "Manga", plural: "manga", singular: "manga" },
	measureFigure: { label: "Chapters", value: mediaActivityCountFigure },
	overviewLoadingDetail: "Fetching the credits and recommendations for this manga.",
	activityCopy: mediaFlatActivityCopy({
		verb: "read",
		noun: "manga",
		progress: mangaProgressLabel,
	}),
	creditCopy: {
		companies: "Publishers",
		people: "Authors & artists",
		notice: "Credits and recommendations",
	},
});
