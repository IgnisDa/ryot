import { bookRecipes } from "../../shared/book-recipes";
import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityCountFigure } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaCountFact, mediaCountLabels, type MediaSummaryFact } from "../media/summary-state";
import { mediaSchemaAspects } from "../schema-aspects";

type BookSummary = MediaSummaryOf<typeof bookRecipes>;

type BookPresentation = MediaPresentationDataOf<typeof bookRecipes>;

export const bookSummaryFacts = (book: BookSummary): readonly MediaSummaryFact[] =>
	[
		mediaCountFact(book.pages, "Page", "book-open"),
		book.isCompilation === null
			? undefined
			: { icon: "layers", label: "Compilation", value: book.isCompilation ? "Yes" : "No" },
	].filter((fact) => fact !== undefined);

export const bookPresentationFacts = (book: BookPresentation) =>
	mediaCountLabels(book.pages, "page");

export const bookSchema = defineFlatMediaSchema({
	recipes: bookRecipes,
	facts: bookSummaryFacts,
	aspect: mediaSchemaAspects.book,
	heroHeight: () => MEDIA_ART_HEIGHT,
	presentationFacts: bookPresentationFacts,
	nouns: { title: "Book", plural: "books", singular: "book" },
	measureFigure: { label: "Pages", value: mediaActivityCountFigure },
	activityCopy: mediaFlatActivityCopy({ verb: "read", noun: "book" }),
	group: { actionLabel: "View series", title: (name) => `Part of ${name}` },
	overviewLoadingDetail: "Fetching the authors, publishers and recommendations for this book.",
	creditCopy: {
		companies: "Publishers",
		people: "Authors & contributors",
		notice: "Authors, publishers and recommendations",
	},
});
