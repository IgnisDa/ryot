import {
	musicActivityRecipe,
	musicOverviewRecipe,
	musicPresentationRecipe,
	musicSummaryRecipe,
	type MusicPresentationData,
	type MusicSummaryResult,
} from "../../shared/music-recipes";
import { mediaActivityTimeLabel, mediaTrackLengthLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaRatingFact, type MediaSummaryFact } from "../media/summary-state";

type MusicSummary = NonNullable<MusicSummaryResult["summary"]>;

export const musicSummaryFacts = (music: MusicSummary): readonly MediaSummaryFact[] =>
	[
		mediaRatingFact(music),
		music.duration === null
			? undefined
			: { icon: "clock", label: "Length", value: mediaTrackLengthLabel(music.duration) },
		music.byVariousArtists === null
			? undefined
			: { icon: "users", label: "Various artists", value: music.byVariousArtists ? "Yes" : "No" },
		music.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: music.productionStatus },
	].filter((fact) => fact !== undefined);

export const musicPresentationFacts = (music: MusicPresentationData) =>
	music.duration === null ? [] : [mediaTrackLengthLabel(music.duration)];

export const musicSchema = defineFlatMediaSchema({
	aspect: "square",
	progressVerb: "played",
	facts: musicSummaryFacts,
	heroHeight: () => MEDIA_ART_HEIGHT,
	presentationFacts: musicPresentationFacts,
	nouns: { title: "Music", plural: "tracks", singular: "track" },
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	group: { actionLabel: "View album", title: (name) => `Part of ${name}` },
	overviewLoadingDetail: "Fetching the artists, labels and recommendations for this track.",
	creditCopy: {
		companies: "Labels",
		people: "Artists & credits",
		notice: "Artists, labels and recommendations",
	},
	recipes: {
		summaryRecipe: musicSummaryRecipe,
		overviewRecipe: musicOverviewRecipe,
		activityRecipe: musicActivityRecipe,
		presentationRecipe: musicPresentationRecipe,
	},
	activityCopy: {
		segmentNoun: "Listen",
		completionsLabel: "Listens",
		recordLabel: "Listen record",
		loadingDetail: "Fetching everything you have recorded for this track.",
		beats: { dropped: "Stopped listening", on_hold: "Put this track on hold" },
		emptyDetail:
			"Nothing has been recorded for this track. Whatever you listen to will appear here as your listen record.",
		rowLabels: {
			review: "Reviewed the track",
			completion: "Finished the track",
			progress: (percent) =>
				percent === undefined ? "Part-way through the track" : `${percent}% through the track`,
		},
	},
});
