import { comicBookRecipes } from "../../shared/comic-book-recipes";
import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityCountFigure } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaCountFact, mediaCountLabels, type MediaSummaryFact } from "../media/summary-state";
import { mediaSchemaAspects } from "../schema-aspects";

type ComicBookSummary = MediaSummaryOf<typeof comicBookRecipes>;

type ComicBookPresentation = MediaPresentationDataOf<typeof comicBookRecipes>;

export const comicBookSummaryFacts = (comicBook: ComicBookSummary): readonly MediaSummaryFact[] =>
	[mediaCountFact(comicBook.pages, "Page", "book-open")].filter((fact) => fact !== undefined);

export const comicBookPresentationFacts = (comicBook: ComicBookPresentation) =>
	mediaCountLabels(comicBook.pages, "page");

export const comicBookSchema = defineFlatMediaSchema({
	recipes: comicBookRecipes,
	facts: comicBookSummaryFacts,
	heroHeight: () => MEDIA_ART_HEIGHT,
	aspect: mediaSchemaAspects["comic-book"],
	presentationFacts: comicBookPresentationFacts,
	measureFigure: { label: "Pages", value: mediaActivityCountFigure },
	activityCopy: mediaFlatActivityCopy({ verb: "read", noun: "comic book" }),
	group: { actionLabel: "View series", title: (name) => `Part of ${name}` },
	nouns: { title: "Comic Book", plural: "comic books", singular: "comic book" },
	overviewLoadingDetail: "Fetching the credits, series and recommendations for this comic book.",
	creditCopy: {
		companies: "Publishers",
		people: "Writers & artists",
		notice: "Credits, series and recommendations",
	},
});
