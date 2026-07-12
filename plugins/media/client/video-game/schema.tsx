import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { videoGameRecipes } from "../../shared/video-game-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityDurationLabel, mediaActivityTimeLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT, MEDIA_BACKDROP_HEIGHT } from "../media/hero";
import {
	mediaProductionStatusFact,
	mediaRatingFact,
	type MediaSummaryFact,
} from "../media/summary-state";
import { videoGameOverviewTrailing } from "./sections";

type VideoGameSummary = MediaSummaryOf<typeof videoGameRecipes>;

type VideoGamePresentation = MediaPresentationDataOf<typeof videoGameRecipes>;

export const videoGameSummaryFacts = (game: VideoGameSummary): readonly MediaSummaryFact[] => {
	const normally = game.timeToBeat?.normally ?? undefined;
	return [
		mediaRatingFact(game),
		normally === undefined
			? undefined
			: { icon: "hourglass", label: "Time to beat", value: mediaActivityDurationLabel(normally) },
		mediaProductionStatusFact(game),
	].filter((fact) => fact !== undefined);
};

export const videoGamePresentationFacts = (game: VideoGamePresentation) =>
	game.timeToBeatNormally === null ? [] : [mediaActivityDurationLabel(game.timeToBeatNormally)];

export const videoGameSchema = defineFlatMediaSchema({
	aspect: "poster",
	progressVerb: "played",
	recipes: videoGameRecipes,
	facts: videoGameSummaryFacts,
	backdropPurposes: ["artwork"],
	overviewTrailing: videoGameOverviewTrailing,
	presentationFacts: videoGamePresentationFacts,
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	nouns: { plural: "games", singular: "game", title: "Video Game" },
	activityCopy: mediaFlatActivityCopy({ verb: "play", noun: "game" }),
	heroHeight: (compact) => (compact ? MEDIA_ART_HEIGHT : MEDIA_BACKDROP_HEIGHT),
	group: { actionLabel: "View collection", title: (name) => `Part of ${name}` },
	overviewLoadingDetail: "Fetching the credits, companies and recommendations for this game.",
	creditCopy: {
		people: "Cast & credits",
		companies: "Developers & publishers",
		notice: "Credits, companies and recommendations",
	},
});
