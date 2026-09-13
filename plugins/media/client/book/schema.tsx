import {
	bookActivityRecipe,
	bookOverviewRecipe,
	bookPresentationRecipe,
	bookSummaryRecipe,
	type BookPresentationData,
	type BookSummaryResult,
} from "../../shared/book-recipes";
import type { MediaFlatActivitySummary } from "../media/flat-activity-state";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaCountLabel, mediaRatingFact, type MediaSummaryFact } from "../media/summary-state";

type BookSummary = NonNullable<BookSummaryResult["summary"]>;

export const bookSummaryFacts = (book: BookSummary): readonly MediaSummaryFact[] =>
	[
		mediaRatingFact(book),
		book.pages === null ? undefined : { label: "Pages", icon: "book-open", value: `${book.pages}` },
		book.isCompilation === null
			? undefined
			: { icon: "layers", label: "Compilation", value: book.isCompilation ? "Yes" : "No" },
		book.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: book.productionStatus },
	].filter((fact) => fact !== undefined);

export const bookPresentationFacts = (book: BookPresentationData) =>
	book.pages === null ? [] : [mediaCountLabel(book.pages, "page")];

export const bookPagesFigure = (amount: MediaFlatActivitySummary["amount"]) =>
	`${Math.round(amount.total)}${amount.missing > 0 ? "+" : ""}`;

export const bookSchema = defineFlatMediaSchema({
	aspect: "poster",
	progressVerb: "read",
	facts: bookSummaryFacts,
	heroHeight: () => MEDIA_ART_HEIGHT,
	presentationFacts: bookPresentationFacts,
	measureFigure: { label: "Pages", value: bookPagesFigure },
	nouns: { title: "Book", plural: "books", singular: "book" },
	group: { actionLabel: "View series", title: (name) => `Part of ${name}` },
	unlinkedCreators: (overview) => overview.creators?.unlinkedCreators ?? [],
	overviewLoadingDetail: "Fetching the authors, publishers and recommendations for this book.",
	creditCopy: {
		companies: "Publishers",
		people: "Authors & contributors",
		notice: "Authors, publishers and recommendations",
	},
	recipes: {
		summaryRecipe: bookSummaryRecipe,
		overviewRecipe: bookOverviewRecipe,
		activityRecipe: bookActivityRecipe,
		presentationRecipe: bookPresentationRecipe,
	},
	activityCopy: {
		segmentNoun: "Read",
		completionsLabel: "Reads",
		recordLabel: "Reading record",
		loadingDetail: "Fetching everything you have recorded for this book.",
		beats: { dropped: "Stopped reading", on_hold: "Put this book on hold" },
		emptyDetail:
			"Nothing has been recorded for this book. Whatever you read will appear here as your reading record.",
		rowLabels: {
			review: "Reviewed the book",
			completion: "Finished the book",
			progress: (percent) =>
				percent === undefined ? "Part-way through the book" : `${percent}% through the book`,
		},
	},
});
