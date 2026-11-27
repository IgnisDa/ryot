import { mangaRecipes } from "../../shared/manga-recipes";
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

type MangaSummary = MediaSummaryOf<typeof mangaRecipes>;

type MangaPresentation = MediaPresentationDataOf<typeof mangaRecipes>;

type MangaListStateSnapshot = Pick<
	Extract<MediaActivityEventOf<typeof mangaRecipes>, { readonly kind: "media" }>,
	"listState"
>;

export const mangaSummaryFacts = (
	manga: MangaSummary,
	{ text }: MediaCopy,
): readonly MediaSummaryFact[] =>
	[
		mediaCountFact(text, manga.chapters, "chapter", "book-open"),
		mediaCountFact(text, manga.volumes, "volume", "layers"),
	].filter((fact) => fact !== undefined);

export const mangaPresentationFacts = (manga: MangaPresentation, { text }: MediaCopy) =>
	mediaCountLabels(text, manga.chapters, "chapter");

export const mangaSchema = defineFlatMediaSchema({
	recipes: mangaRecipes,
	facts: mangaSummaryFacts,
	aspect: mediaSchemaAspects.manga,
	presentationFacts: mangaPresentationFacts,
	overviewLoadingDetail: catalogMessage("overview.loading.manga"),
	measureFigure: { value: mediaActivityCountFigure, label: catalogMessage("property.chapters") },
	logActivity: {
		itemContext: true,
		family: "positional",
		units: ["chapters", "volumes"],
		copy: { verb: "read", kind: "manga" },
	},
	creditCopy: {
		notice: catalogMessage("credits.notice.manga"),
		companies: catalogMessage("credits.publishers"),
		people: catalogMessage("credits.authors-artists"),
	},
	activityCopy: (copy) =>
		mediaFlatActivityCopy<MangaListStateSnapshot>(copy, {
			verb: "read",
			kind: "manga",
			snapshot: { source: "anilist", detail: mediaListStateDetail },
		}),
});
