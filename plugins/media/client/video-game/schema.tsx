import {
	videoGameActivityRecipe,
	videoGameOverviewRecipe,
	videoGamePresentationRecipe,
	videoGameSummaryRecipe,
	type VideoGamePresentationData,
	type VideoGameSummaryResult,
} from "../../shared/video-game-recipes";
import { mediaActivityDurationLabel, mediaActivityTimeLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT, MEDIA_BACKDROP_HEIGHT } from "../media/hero";
import { mediaRatingFact, type MediaSummaryFact } from "../media/summary-state";
import { videoGameOverviewTrailing } from "./sections";

type VideoGameSummary = NonNullable<VideoGameSummaryResult["summary"]>;

export const videoGameSummaryFacts = (game: VideoGameSummary): readonly MediaSummaryFact[] => {
	const normally = game.timeToBeat?.normally ?? undefined;
	return [
		mediaRatingFact(game),
		normally === undefined
			? undefined
			: { icon: "hourglass", label: "Time to beat", value: mediaActivityDurationLabel(normally) },
		game.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: game.productionStatus },
	].filter((fact) => fact !== undefined);
};

export const videoGamePresentationFacts = (game: VideoGamePresentationData) =>
	game.timeToBeatNormally === null ? [] : [mediaActivityDurationLabel(game.timeToBeatNormally)];

export const videoGameSchema = defineFlatMediaSchema({
	aspect: "poster",
	progressVerb: "played",
	facts: videoGameSummaryFacts,
	backdropPurposes: ["artwork"],
	overviewTrailing: videoGameOverviewTrailing,
	presentationFacts: videoGamePresentationFacts,
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	nouns: { plural: "games", singular: "game", title: "Video Game" },
	heroHeight: (compact) => (compact ? MEDIA_ART_HEIGHT : MEDIA_BACKDROP_HEIGHT),
	group: { actionLabel: "View collection", title: (name) => `Part of ${name}` },
	overviewLoadingDetail: "Fetching the credits, companies and recommendations for this game.",
	creditCopy: {
		people: "Cast & credits",
		companies: "Developers & publishers",
		notice: "Credits, companies and recommendations",
	},
	recipes: {
		summaryRecipe: videoGameSummaryRecipe,
		overviewRecipe: videoGameOverviewRecipe,
		activityRecipe: videoGameActivityRecipe,
		presentationRecipe: videoGamePresentationRecipe,
	},
	activityCopy: {
		segmentNoun: "Play",
		recordLabel: "Play record",
		completionsLabel: "Playthroughs",
		loadingDetail: "Fetching everything you have recorded for this game.",
		beats: { dropped: "Stopped playing", on_hold: "Put this game on hold" },
		emptyDetail:
			"Nothing has been recorded for this game. Whatever you play will appear here as your play record.",
		rowLabels: {
			review: "Reviewed the game",
			completion: "Finished the game",
			progress: (percent) =>
				percent === undefined ? "Part-way through the game" : `${percent}% through the game`,
		},
	},
});
