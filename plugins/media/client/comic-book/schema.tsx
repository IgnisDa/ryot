import { comicBookRecipes } from "../../shared/comic-book-recipes";
import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityCountFigure } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { mediaCountFact, mediaCountLabels, type MediaSummaryFact } from "../media/summary-state";
import type { MediaCopy } from "../messages";
import { mediaSchemaAspects } from "../schema-aspects";

type ComicBookSummary = MediaSummaryOf<typeof comicBookRecipes>;

type ComicBookPresentation = MediaPresentationDataOf<typeof comicBookRecipes>;

export const comicBookSummaryFacts = (
	comicBook: ComicBookSummary,
	{ text }: MediaCopy,
): readonly MediaSummaryFact[] =>
	[mediaCountFact(text, comicBook.pages, "page", "book-open")].filter((fact) => fact !== undefined);

export const comicBookPresentationFacts = (comicBook: ComicBookPresentation, { text }: MediaCopy) =>
	mediaCountLabels(text, comicBook.pages, "page");

export const comicBookSchema = defineFlatMediaSchema({
	recipes: comicBookRecipes,
	facts: comicBookSummaryFacts,
	aspect: mediaSchemaAspects["comic-book"],
	presentationFacts: comicBookPresentationFacts,
	group: { actionLabel: catalogMessage("group.view-series") },
	overviewLoadingDetail: catalogMessage("overview.loading.comic-book"),
	logActivity: { family: "flat", copy: { verb: "read", kind: "comic_book" } },
	activityCopy: (copy) => mediaFlatActivityCopy(copy, { verb: "read", kind: "comic_book" }),
	measureFigure: { value: mediaActivityCountFigure, label: catalogMessage("property.pages") },
	creditCopy: {
		companies: catalogMessage("credits.publishers"),
		people: catalogMessage("credits.writers-artists"),
		notice: catalogMessage("credits.notice.comic-book"),
	},
});
