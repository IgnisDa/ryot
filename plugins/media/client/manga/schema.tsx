import { mangaRecipes } from "../../shared/manga-recipes";
import type {
	MediaActivityEventOf,
	MediaPresentationDataOf,
	MediaSummaryOf,
} from "../../shared/media-recipes";
import { mediaFlatActivityCopy, mediaListStateDetail } from "../media/activity-copy";
import { mediaActivityCountFigure } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { mediaCountFact, mediaCountLabels, type MediaSummaryFact } from "../media/summary-state";
import { mediaSchemaAspects } from "../schema-aspects";

type MangaSummary = MediaSummaryOf<typeof mangaRecipes>;

type MangaPresentation = MediaPresentationDataOf<typeof mangaRecipes>;

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

export const mangaSchema = defineFlatMediaSchema({
	recipes: mangaRecipes,
	facts: mangaSummaryFacts,
	aspect: mediaSchemaAspects.manga,
	presentationFacts: mangaPresentationFacts,
	nouns: { title: "Manga", plural: "manga", singular: "manga" },
	measureFigure: { label: "Chapters", value: mediaActivityCountFigure },
	overviewLoadingDetail: "Fetching the credits and recommendations for this manga.",
	creditCopy: {
		companies: "Publishers",
		people: "Authors & artists",
		notice: "Credits and recommendations",
	},
	activityCopy: mediaFlatActivityCopy<MangaListStateSnapshot>({
		verb: "read",
		noun: "manga",
		snapshot: { label: "Synced from AniList", detail: mediaListStateDetail },
	}),
	logActivity: {
		family: "positional",
		itemContextLabel: "Volume context",
		copy: { verb: "read", noun: "manga", gerund: "reading", participle: "read" },
		progressUnit: { field: "chapters", plural: "chapters", singular: "chapter" },
		itemUnits: [
			{ label: "Chapter", value: "chapters" },
			{ label: "Volume", value: "volumes" },
		],
	},
});
