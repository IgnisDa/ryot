import { bookRecipes } from "../../shared/book-recipes";
import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityCountFigure } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { mediaCountFact, mediaCountLabels, type MediaSummaryFact } from "../media/summary-state";
import type { MediaCopy } from "../messages";
import { mediaSchemaAspects } from "../schema-aspects";

type BookSummary = MediaSummaryOf<typeof bookRecipes>;

type BookPresentation = MediaPresentationDataOf<typeof bookRecipes>;

export const bookSummaryFacts = (
	book: BookSummary,
	{ text }: MediaCopy,
): readonly MediaSummaryFact[] =>
	[
		mediaCountFact(text, book.pages, "page", "book-open"),
		book.isCompilation === null
			? undefined
			: {
					icon: "layers",
					label: text("fact.compilation"),
					value: book.isCompilation ? text("common.value.yes") : text("common.value.no"),
				},
	].filter((fact) => fact !== undefined);

export const bookPresentationFacts = (book: BookPresentation, { text }: MediaCopy) =>
	mediaCountLabels(text, book.pages, "page");

export const bookSchema = defineFlatMediaSchema({
	recipes: bookRecipes,
	facts: bookSummaryFacts,
	aspect: mediaSchemaAspects.book,
	presentationFacts: bookPresentationFacts,
	group: { actionLabel: catalogMessage("group.view-series") },
	overviewLoadingDetail: catalogMessage("overview.loading.book"),
	activityCopy: (copy) => mediaFlatActivityCopy(copy, { verb: "read", kind: "book" }),
	measureFigure: { value: mediaActivityCountFigure, label: catalogMessage("property.pages") },
	logActivity: {
		family: "flat",
		progressUnit: { field: "pages" },
		copy: { verb: "read", kind: "book" },
	},
	creditCopy: {
		notice: catalogMessage("credits.notice.book"),
		companies: catalogMessage("credits.publishers"),
		people: catalogMessage("credits.authors-contributors"),
	},
});
