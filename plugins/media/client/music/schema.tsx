import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { musicRecipes } from "../../shared/music-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityTimeLabel, mediaTrackLengthLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import {
	mediaProductionStatusFact,
	mediaRatingFact,
	type MediaSummaryFact,
} from "../media/summary-state";

type MusicSummary = MediaSummaryOf<typeof musicRecipes>;

type MusicPresentation = MediaPresentationDataOf<typeof musicRecipes>;

export const musicSummaryFacts = (music: MusicSummary): readonly MediaSummaryFact[] =>
	[
		mediaRatingFact(music),
		music.duration === null
			? undefined
			: { icon: "clock", label: "Length", value: mediaTrackLengthLabel(music.duration) },
		music.byVariousArtists === null
			? undefined
			: { icon: "users", label: "Various artists", value: music.byVariousArtists ? "Yes" : "No" },
		mediaProductionStatusFact(music),
	].filter((fact) => fact !== undefined);

export const musicPresentationFacts = (music: MusicPresentation) =>
	music.duration === null ? [] : [mediaTrackLengthLabel(music.duration)];

export const musicSchema = defineFlatMediaSchema({
	aspect: "square",
	recipes: musicRecipes,
	progressVerb: "played",
	facts: musicSummaryFacts,
	heroHeight: () => MEDIA_ART_HEIGHT,
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
});
