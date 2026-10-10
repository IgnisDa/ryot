import { mangaRecipes } from "../../shared/manga-recipes";
import type {
	MediaActivityEventOf,
	MediaPresentationDataOf,
	MediaSummaryOf,
} from "../../shared/media-recipes";
import { mediaFlatActivityCopy, mediaListStateDetail } from "../media/activity-copy";
import { decimalLabel, mediaActivityCountFigure } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaCountFact, mediaCountLabels, type MediaSummaryFact } from "../media/summary-state";
import { mediaSchemaAspects } from "../schema-aspects";

type MangaSummary = MediaSummaryOf<typeof mangaRecipes>;

type MangaPresentation = MediaPresentationDataOf<typeof mangaRecipes>;

type MangaProgressPosition = Pick<
	Extract<MediaActivityEventOf<typeof mangaRecipes>, { readonly kind: "media" }>,
	"mangaChapter" | "mangaVolume"
>;

type MangaListStateSnapshot = Pick<
	Extract<MediaActivityEventOf<typeof mangaRecipes>, { readonly kind: "media" }>,
	"listState"
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

export const mangaListStateDetail = (event: MangaListStateSnapshot) => {
	const volume = event.listState?.mangaVolume;
	const chapter = event.listState?.mangaChapter;
	return mediaListStateDetail(event.listState, [
		volume === undefined ? undefined : `Volume ${volume}`,
		chapter === undefined ? undefined : `Chapter ${decimalLabel(chapter)}`,
	]);
};

export const mangaSchema = defineFlatMediaSchema({
	recipes: mangaRecipes,
	facts: mangaSummaryFacts,
	aspect: mediaSchemaAspects.manga,
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
	activityCopy: mediaFlatActivityCopy<MangaProgressPosition & MangaListStateSnapshot>({
		verb: "read",
		noun: "manga",
		progress: mangaProgressLabel,
		snapshot: { label: "Synced from AniList", detail: mangaListStateDetail },
	}),
});
