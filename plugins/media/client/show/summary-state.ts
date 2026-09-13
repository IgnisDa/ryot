import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import type { ShowSummaryResult } from "../../shared/show-recipes";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "../media/query-state";
import { mediaCountFact, mediaCountLabel } from "../media/summary-state";

export type ShowSummary = NonNullable<ShowSummaryResult["show"]>;

type ShowSummaryUnavailableReason = "missing" | "unsupported";

export type ShowSummaryState = MappedRyotQueryState<
	| { readonly status: "ready"; readonly show: ShowSummary }
	| { readonly status: "unavailable"; readonly reason: ShowSummaryUnavailableReason }
>;

type ShowSummaryFailure = Pick<
	Extract<ShowSummaryState, { status: "transport-error" | "malformed" }>,
	"status"
>;

export const mapShowSummary = (result: RyotQueryResult<ShowSummaryResult>): ShowSummaryState => {
	const state = classifyRyotQueryResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const { show, entitySchemaSlug } = state.value;
	if (show === null) {
		return { status: "unavailable", reason: entitySchemaSlug === null ? "missing" : "unsupported" };
	}
	return { show, status: "ready" };
};

export const showSummaryError = (state: ShowSummaryFailure) =>
	state.status === "transport-error"
		? {
				title: "Unable to load this show",
				detail: "The server could not load this show. Check your connection and try again.",
			}
		: {
				title: "Unable to display this show",
				detail: "This show returned data that could not be displayed. Try again later.",
			};

export const showSummaryUnavailable = (reason: ShowSummaryUnavailableReason) => ({
	title: "Show unavailable",
	detail:
		reason === "missing"
			? "This entity no longer exists."
			: "This entity is not a show, and only shows can be opened here.",
});

const LIFECYCLE_LABELS: Record<ShowSummary["state"], string> = {
	on_hold: "On hold",
	dropped: "Dropped",
	complete: "Complete",
	backlog: "In backlog",
	caught_up: "Caught up",
	untracked: "Not tracked",
	in_progress: "In progress",
};

export const showLifecycleLabel = (state: ShowSummary["state"]) => LIFECYCLE_LABELS[state];

export const showSeasonCountLabel = (show: ShowSummary) =>
	show.totalSeasons === null ? undefined : mediaCountLabel(show.totalSeasons, "season");

export const showEpisodeCountLabel = (show: ShowSummary) =>
	show.totalEpisodes === null ? undefined : mediaCountLabel(show.totalEpisodes, "episode");

export const showSeasonFact = (show: ShowSummary) => mediaCountFact(show.totalSeasons, "Season");

export const showEpisodeFact = (show: ShowSummary) => mediaCountFact(show.totalEpisodes, "Episode");
