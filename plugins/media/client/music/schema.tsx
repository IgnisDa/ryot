import { formatClock } from "@ryot-app/plugin-ui-sdk";

import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { musicRecipes } from "../../shared/music-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityTimeLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import type { MediaSummaryFact } from "../media/summary-state";
import type { MediaCopy } from "../messages";
import { mediaSchemaAspects } from "../schema-aspects";

type MusicSummary = MediaSummaryOf<typeof musicRecipes>;

type MusicPresentation = MediaPresentationDataOf<typeof musicRecipes>;

export const musicSummaryFacts = (
	music: MusicSummary,
	{ text }: MediaCopy,
): readonly MediaSummaryFact[] =>
	[
		music.duration === null
			? undefined
			: {
					inline: true,
					icon: "clock",
					label: text("fact.length"),
					value: formatClock(music.duration),
				},
		music.byVariousArtists === null
			? undefined
			: {
					icon: "users",
					label: text("property.various-artists"),
					value: music.byVariousArtists ? text("common.value.yes") : text("common.value.no"),
				},
	].filter((fact) => fact !== undefined);

export const musicPresentationFacts = (music: MusicPresentation) =>
	music.duration === null ? [] : [formatClock(music.duration)];

export const musicSchema = defineFlatMediaSchema({
	recipes: musicRecipes,
	facts: musicSummaryFacts,
	aspect: mediaSchemaAspects.music,
	presentationFacts: musicPresentationFacts,
	group: { actionLabel: catalogMessage("group.view-album") },
	overviewLoadingDetail: catalogMessage("overview.loading.music"),
	logActivity: { family: "flat", copy: { kind: "music", verb: "listen" } },
	activityCopy: (copy) => mediaFlatActivityCopy(copy, { kind: "music", verb: "listen" }),
	measureFigure: { value: mediaActivityTimeLabel, label: catalogMessage("activity.figure-time") },
	creditCopy: {
		companies: catalogMessage("credits.labels"),
		notice: catalogMessage("credits.notice.music"),
		people: catalogMessage("credits.artists-credits"),
	},
});
