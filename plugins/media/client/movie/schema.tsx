import {
	movieActivityRecipe,
	movieOverviewRecipe,
	moviePresentationRecipe,
	movieSummaryRecipe,
	type MoviePresentationData,
	type MovieSummaryResult,
} from "../../shared/movie-recipes";
import { mediaActivityDurationLabel, mediaActivityTimeLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT, MEDIA_BACKDROP_HEIGHT } from "../media/hero";
import { mediaRatingFact, type MediaSummaryFact } from "../media/summary-state";

type MovieSummary = NonNullable<MovieSummaryResult["summary"]>;

export const movieSummaryFacts = (movie: MovieSummary): readonly MediaSummaryFact[] =>
	[
		mediaRatingFact(movie),
		movie.runtime === null
			? undefined
			: { icon: "clock", label: "Runtime", value: mediaActivityDurationLabel(movie.runtime) },
		movie.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: movie.productionStatus },
	].filter((fact) => fact !== undefined);

export const moviePresentationFacts = (movie: MoviePresentationData) =>
	movie.runtime === null ? [] : [mediaActivityDurationLabel(movie.runtime)];

export const movieSchema = defineFlatMediaSchema({
	aspect: "poster",
	progressVerb: "watched",
	facts: movieSummaryFacts,
	watchProviders: (movie) => movie,
	presentationFacts: moviePresentationFacts,
	nouns: { title: "Movie", plural: "movies", singular: "movie" },
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	heroHeight: (compact) => (compact ? MEDIA_ART_HEIGHT : MEDIA_BACKDROP_HEIGHT),
	group: { actionLabel: "View collection", title: (name) => `Part of ${name}` },
	overviewLoadingDetail: "Fetching the cast, companies and recommendations for this movie.",
	creditCopy: {
		people: "Cast & crew",
		companies: "Production companies",
		notice: "Cast, companies and recommendations",
	},
	recipes: {
		summaryRecipe: movieSummaryRecipe,
		overviewRecipe: movieOverviewRecipe,
		activityRecipe: movieActivityRecipe,
		presentationRecipe: moviePresentationRecipe,
	},
	activityCopy: {
		segmentNoun: "Watch",
		recordLabel: "Watch record",
		completionsLabel: "Watches",
		loadingDetail: "Fetching everything you have recorded for this movie.",
		beats: { dropped: "Stopped watching", on_hold: "Put this movie on hold" },
		emptyDetail:
			"Nothing has been recorded for this movie. Whatever you watch will appear here as your watch record.",
		rowLabels: {
			review: "Reviewed the movie",
			completion: "Finished the movie",
			progress: (percent) =>
				percent === undefined ? "Part-way through the movie" : `${percent}% through the movie`,
		},
	},
});
