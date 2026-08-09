import type { MovieSummaryResult } from "../../shared/movie-recipes";
import { mediaActivityDurationLabel } from "../media/activity-timeline";
import {
	mediaRatingFact,
	mediaSummaryStateMapper,
	type MediaSummaryFact,
	type MediaSummaryState,
} from "../media/summary-state";

export type MovieSummary = NonNullable<MovieSummaryResult["movie"]>;

export type MovieSummaryState = MediaSummaryState<MovieSummary>;

export const MOVIE_TYPE_LABEL = "Movie";

const movieSummaryState = mediaSummaryStateMapper<MovieSummaryResult, MovieSummary>({
	plural: "movies",
	singular: "movie",
	title: MOVIE_TYPE_LABEL,
	select: ({ movie }) => movie,
});

export const mapMovieSummary = movieSummaryState.mapSummary;

export const movieSummaryError = movieSummaryState.summaryError;

export const movieSummaryUnavailable = movieSummaryState.summaryUnavailable;

const MOVIE_LIFECYCLE_LABELS: Record<MovieSummary["state"], string> = {
	on_hold: "On hold",
	dropped: "Dropped",
	complete: "Complete",
	backlog: "In backlog",
	untracked: "Not tracked",
	in_progress: "In progress",
};

export const movieLifecycleLabel = (state: MovieSummary["state"]) => MOVIE_LIFECYCLE_LABELS[state];

export const movieRuntimeFact = (movie: Pick<MovieSummary, "runtime">) =>
	movie.runtime === null
		? undefined
		: { icon: "clock", label: "Runtime", value: mediaActivityDurationLabel(movie.runtime) };

export const movieSummaryFacts = (movie: MovieSummary): readonly MediaSummaryFact[] => {
	const runtime = movieRuntimeFact(movie);
	return [
		mediaRatingFact(movie),
		runtime,
		movie.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: movie.productionStatus },
	].filter((fact) => fact !== undefined);
};

export const movieSummaryProgress = (movie: MovieSummary) =>
	movie.state === "in_progress" && movie.progressPercent !== null
		? { percent: movie.progressPercent }
		: undefined;
