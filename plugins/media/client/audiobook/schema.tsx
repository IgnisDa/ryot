import { audiobookRecipes } from "../../shared/audiobook-recipes";
import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityTimeLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import {
	mediaDurationFact,
	mediaDurationLabels,
	type MediaSummaryFact,
} from "../media/summary-state";

type AudiobookSummary = MediaSummaryOf<typeof audiobookRecipes>;

type AudiobookPresentation = MediaPresentationDataOf<typeof audiobookRecipes>;

export const audiobookSummaryFacts = (audiobook: AudiobookSummary): readonly MediaSummaryFact[] =>
	[mediaDurationFact(audiobook.runtime, "Length")].filter((fact) => fact !== undefined);

export const audiobookPresentationFacts = (audiobook: AudiobookPresentation) =>
	mediaDurationLabels(audiobook.runtime);

export const audiobookSchema = defineFlatMediaSchema({
	aspect: "square",
	recipes: audiobookRecipes,
	facts: audiobookSummaryFacts,
	heroHeight: () => MEDIA_ART_HEIGHT,
	presentationFacts: audiobookPresentationFacts,
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	group: { actionLabel: "View series", title: (name) => `Part of ${name}` },
	activityCopy: mediaFlatActivityCopy({ verb: "listen", noun: "audiobook" }),
	nouns: { title: "Audiobook", plural: "audiobooks", singular: "audiobook" },
	overviewLoadingDetail: "Fetching the authors, narrators and recommendations for this audiobook.",
	creditCopy: {
		companies: "Publishers",
		people: "Authors & narrators",
		notice: "Authors, narrators and recommendations",
	},
});
