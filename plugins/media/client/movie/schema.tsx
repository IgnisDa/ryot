import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { movieRecipes } from "../../shared/movie-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityDurationLabel, mediaActivityTimeLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT, MEDIA_BACKDROP_HEIGHT } from "../media/hero";
import { mediaWatchProvidersTrailing } from "../media/overview";
import {
	mediaProductionStatusFact,
	mediaRatingFact,
	type MediaSummaryFact,
} from "../media/summary-state";

type MovieSummary = MediaSummaryOf<typeof movieRecipes>;

type MoviePresentation = MediaPresentationDataOf<typeof movieRecipes>;

export const movieSummaryFacts = (movie: MovieSummary): readonly MediaSummaryFact[] =>
	[
		mediaRatingFact(movie),
		movie.runtime === null
			? undefined
			: { icon: "clock", label: "Runtime", value: mediaActivityDurationLabel(movie.runtime) },
		mediaProductionStatusFact(movie),
	].filter((fact) => fact !== undefined);

export const moviePresentationFacts = (movie: MoviePresentation) =>
	movie.runtime === null ? [] : [mediaActivityDurationLabel(movie.runtime)];

export const movieSchema = defineFlatMediaSchema({
	aspect: "poster",
	recipes: movieRecipes,
	progressVerb: "watched",
	facts: movieSummaryFacts,
	presentationFacts: moviePresentationFacts,
	nouns: { title: "Movie", plural: "movies", singular: "movie" },
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	overviewTrailing: mediaWatchProvidersTrailing((summary) => summary),
	activityCopy: mediaFlatActivityCopy({ verb: "watch", noun: "movie" }),
	heroHeight: (compact) => (compact ? MEDIA_ART_HEIGHT : MEDIA_BACKDROP_HEIGHT),
	group: { actionLabel: "View collection", title: (name) => `Part of ${name}` },
	overviewLoadingDetail: "Fetching the cast, companies and recommendations for this movie.",
	creditCopy: {
		people: "Cast & crew",
		companies: "Production companies",
		notice: "Cast, companies and recommendations",
	},
});
