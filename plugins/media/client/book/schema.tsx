import { bookRecipes } from "../../shared/book-recipes";
import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityCountFigure } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import {
	mediaCountLabel,
	mediaProductionStatusFact,
	mediaRatingFact,
	type MediaSummaryFact,
} from "../media/summary-state";

type BookSummary = MediaSummaryOf<typeof bookRecipes>;

type BookPresentation = MediaPresentationDataOf<typeof bookRecipes>;

export const bookSummaryFacts = (book: BookSummary): readonly MediaSummaryFact[] =>
	[
		mediaRatingFact(book),
		book.pages === null ? undefined : { label: "Pages", icon: "book-open", value: `${book.pages}` },
		book.isCompilation === null
			? undefined
			: { icon: "layers", label: "Compilation", value: book.isCompilation ? "Yes" : "No" },
		mediaProductionStatusFact(book),
	].filter((fact) => fact !== undefined);

export const bookPresentationFacts = (book: BookPresentation) =>
	book.pages === null ? [] : [mediaCountLabel(book.pages, "page")];

export const bookSchema = defineFlatMediaSchema({
	aspect: "poster",
	recipes: bookRecipes,
	progressVerb: "read",
	facts: bookSummaryFacts,
	heroHeight: () => MEDIA_ART_HEIGHT,
	presentationFacts: bookPresentationFacts,
	nouns: { title: "Book", plural: "books", singular: "book" },
	measureFigure: { label: "Pages", value: mediaActivityCountFigure },
	activityCopy: mediaFlatActivityCopy({ verb: "read", noun: "book" }),
	group: { actionLabel: "View series", title: (name) => `Part of ${name}` },
	unlinkedCreators: (overview) => overview.creators?.unlinkedCreators ?? [],
	overviewLoadingDetail: "Fetching the authors, publishers and recommendations for this book.",
	creditCopy: {
		companies: "Publishers",
		people: "Authors & contributors",
		notice: "Authors, publishers and recommendations",
	},
});
