import { audiobookRecipes } from "../../shared/audiobook-recipes";
import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
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

type AudiobookSummary = MediaSummaryOf<typeof audiobookRecipes>;

type AudiobookPresentation = MediaPresentationDataOf<typeof audiobookRecipes>;

export const audiobookSummaryFacts = (
	audiobook: AudiobookSummary,
	copy: MediaCopy,
): readonly MediaSummaryFact[] =>
	[mediaDurationFact(copy, audiobook.runtime, copy.text("fact.length"))].filter(
		(fact) => fact !== undefined,
	);

export const audiobookPresentationFacts = (
	audiobook: AudiobookPresentation,
	{ formatters }: MediaCopy,
) => mediaDurationLabels(formatters, audiobook.runtime);

export const audiobookSchema = defineFlatMediaSchema({
	recipes: audiobookRecipes,
	facts: audiobookSummaryFacts,
	aspect: mediaSchemaAspects.audiobook,
	presentationFacts: audiobookPresentationFacts,
	group: { actionLabel: catalogMessage("group.view-series") },
	overviewLoadingDetail: catalogMessage("overview.loading.audiobook"),
	activityCopy: (copy) => mediaFlatActivityCopy(copy, { verb: "listen", kind: "audiobook" }),
	measureFigure: { value: mediaActivityTimeLabel, label: catalogMessage("activity.figure-time") },
	logActivity: {
		family: "flat",
		progressUnit: { field: "runtime" },
		copy: { verb: "listen", kind: "audiobook" },
	},
	creditCopy: {
		companies: catalogMessage("credits.publishers"),
		notice: catalogMessage("credits.notice.audiobook"),
		people: catalogMessage("credits.authors-narrators"),
	},
});
