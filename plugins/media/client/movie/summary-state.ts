import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import type { MovieSummaryResult } from "../../shared/movie-recipes";
import { mediaActivityDurationLabel } from "../media/activity-timeline";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "../media/query-state";
import { mediaRatingFact, type MediaSummaryFact } from "../media/summary-state";

export type MovieSummary = NonNullable<MovieSummaryResult["movie"]>;

type MovieSummaryUnavailableReason = "missing" | "unsupported";

export type MovieSummaryState = MappedRyotQueryState<
	| { readonly status: "ready"; readonly movie: MovieSummary }
	| { readonly status: "unavailable"; readonly reason: MovieSummaryUnavailableReason }
>;

type MovieSummaryFailure = Pick<
	Extract<MovieSummaryState, { status: "transport-error" | "malformed" }>,
	"status"
>;

export const MOVIE_TYPE_LABEL = "Movie";

export const mapMovieSummary = (result: RyotQueryResult<MovieSummaryResult>): MovieSummaryState => {
	const state = classifyRyotQueryResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const { movie, entitySchemaSlug } = state.value;
	if (movie === null) {
		return { status: "unavailable", reason: entitySchemaSlug === null ? "missing" : "unsupported" };
	}
	return { movie, status: "ready" };
};

export const movieSummaryError = (state: MovieSummaryFailure) =>
	state.status === "transport-error"
		? {
				title: "Unable to load this movie",
				detail: "The server could not load this movie. Check your connection and try again.",
			}
		: {
				title: "Unable to display this movie",
				detail: "This movie returned data that could not be displayed. Try again later.",
			};

export const movieSummaryUnavailable = (reason: MovieSummaryUnavailableReason) => ({
	title: "Movie unavailable",
	detail:
		reason === "missing"
			? "This entity no longer exists."
			: "This entity is not a movie, and only movies can be opened here.",
});

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
