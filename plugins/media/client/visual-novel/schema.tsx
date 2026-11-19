import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { visualNovelRecipes } from "../../shared/visual-novel-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityTimeLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import {
	mediaDurationFact,
	mediaDurationLabels,
	type MediaSummaryFact,
} from "../media/summary-state";
import type { MediaCopy } from "../messages";
import { mediaSchemaAspects } from "../schema-aspects";

type VisualNovelSummary = MediaSummaryOf<typeof visualNovelRecipes>;

type VisualNovelPresentation = MediaPresentationDataOf<typeof visualNovelRecipes>;

export const visualNovelSummaryFacts = (
	visualNovel: VisualNovelSummary,
	copy: MediaCopy,
): readonly MediaSummaryFact[] =>
	[mediaDurationFact(copy, visualNovel.lengthMinutes, copy.text("fact.length"))].filter(
		(fact) => fact !== undefined,
	);

export const visualNovelPresentationFacts = (
	visualNovel: VisualNovelPresentation,
	{ formatters }: MediaCopy,
) => mediaDurationLabels(formatters, visualNovel.lengthMinutes);

export const visualNovelSchema = defineFlatMediaSchema({
	recipes: visualNovelRecipes,
	facts: visualNovelSummaryFacts,
	aspect: mediaSchemaAspects["visual-novel"],
	presentationFacts: visualNovelPresentationFacts,
	overviewLoadingDetail: catalogMessage("overview.loading.visual-novel"),
	logActivity: { family: "flat", copy: { verb: "read", kind: "visual_novel" } },
	activityCopy: (copy) => mediaFlatActivityCopy(copy, { verb: "read", kind: "visual_novel" }),
	measureFigure: { value: mediaActivityTimeLabel, label: catalogMessage("activity.figure-time") },
	creditCopy: {
		people: catalogMessage("credits.developers"),
		companies: catalogMessage("credits.publishers"),
		notice: catalogMessage("credits.notice.visual-novel"),
	},
});
