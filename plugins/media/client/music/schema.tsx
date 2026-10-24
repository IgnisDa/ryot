import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { musicRecipes } from "../../shared/music-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityTimeLabel, mediaTrackLengthLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import type { MediaSummaryFact } from "../media/summary-state";
import { mediaSchemaAspects } from "../schema-aspects";

type MusicSummary = MediaSummaryOf<typeof musicRecipes>;

type MusicPresentation = MediaPresentationDataOf<typeof musicRecipes>;

export const musicSummaryFacts = (music: MusicSummary): readonly MediaSummaryFact[] =>
	[
		music.duration === null
			? undefined
			: {
					inline: true,
					icon: "clock",
					label: "Length",
					value: mediaTrackLengthLabel(music.duration),
				},
		music.byVariousArtists === null
			? undefined
			: { icon: "users", label: "Various artists", value: music.byVariousArtists ? "Yes" : "No" },
	].filter((fact) => fact !== undefined);

export const musicPresentationFacts = (music: MusicPresentation) =>
	music.duration === null ? [] : [mediaTrackLengthLabel(music.duration)];

export const musicSchema = defineFlatMediaSchema({
	recipes: musicRecipes,
	facts: musicSummaryFacts,
	aspect: mediaSchemaAspects.music,
	presentationFacts: musicPresentationFacts,
	nouns: { title: "Music", plural: "tracks", singular: "track" },
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	activityCopy: mediaFlatActivityCopy({ noun: "track", verb: "listen" }),
	group: { actionLabel: "View album", title: (name) => `Part of ${name}` },
	overviewLoadingDetail: "Fetching the artists, labels and recommendations for this track.",
	creditCopy: {
		companies: "Labels",
		people: "Artists & credits",
		notice: "Artists, labels and recommendations",
	},
	logActivity: {
		family: "flat",
		copy: { noun: "track", verb: "listen to", gerund: "listening", participle: "listened" },
	},
});
