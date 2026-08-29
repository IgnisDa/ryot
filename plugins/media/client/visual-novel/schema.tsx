import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { visualNovelRecipes } from "../../shared/visual-novel-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityTimeLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import {
	mediaDurationFact,
	mediaDurationLabels,
	type MediaSummaryFact,
} from "../media/summary-state";
import { mediaSchemaAspects } from "../schema-aspects";

type VisualNovelSummary = MediaSummaryOf<typeof visualNovelRecipes>;

type VisualNovelPresentation = MediaPresentationDataOf<typeof visualNovelRecipes>;

export const visualNovelSummaryFacts = (
	visualNovel: VisualNovelSummary,
): readonly MediaSummaryFact[] =>
	[mediaDurationFact(visualNovel.lengthMinutes, "Length")].filter((fact) => fact !== undefined);

export const visualNovelPresentationFacts = (visualNovel: VisualNovelPresentation) =>
	mediaDurationLabels(visualNovel.lengthMinutes);

export const visualNovelSchema = defineFlatMediaSchema({
	recipes: visualNovelRecipes,
	facts: visualNovelSummaryFacts,
	heroHeight: () => MEDIA_ART_HEIGHT,
	aspect: mediaSchemaAspects["visual-novel"],
	presentationFacts: visualNovelPresentationFacts,
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	activityCopy: mediaFlatActivityCopy({ verb: "read", noun: "visual novel" }),
	nouns: { title: "Visual Novel", plural: "visual novels", singular: "visual novel" },
	overviewLoadingDetail: "Fetching the developers and recommendations for this visual novel.",
	creditCopy: {
		people: "Developers",
		companies: "Publishers",
		notice: "Developers and recommendations",
	},
});
