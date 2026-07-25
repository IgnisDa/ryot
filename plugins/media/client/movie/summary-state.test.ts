import { describe, expect, it } from "vitest";

import {
	decodeMovieSummary,
	decodeMovieSummaryResult,
	movieSummaryRow,
} from "../../tests/client/movie/summary-fixture";
import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "../../tests/client/query-result-fixture";
import {
	mapMovieSummary,
	movieLifecycleLabel,
	movieRuntimeFact,
	movieSummaryError,
	movieSummaryFacts,
	movieSummaryProgress,
	movieSummaryUnavailable,
} from "./summary-state";

describe("movie summary state", () => {
	it("maps a pending query to the loading state", () => {
		expect(mapMovieSummary(pendingQueryResult())).toEqual({ status: "loading" });
	});

	it("maps a malformed decode failure apart from a transport failure", () => {
		expect(mapMovieSummary(malformedQueryResult()).status).toBe("malformed");
		expect(mapMovieSummary(transportErrorQueryResult()).status).toBe("transport-error");
	});

	it("maps an absent entity to the missing unavailable reason", () => {
		const value = decodeMovieSummaryResult({ movie: [], requested: [] });

		expect(mapMovieSummary(readyQueryResult(value))).toEqual({
			reason: "missing",
			status: "unavailable",
		});
	});

	it("maps a non-movie entity to the unsupported unavailable reason", () => {
		const value = decodeMovieSummaryResult({ movie: [], requested: [{ schemaSlug: "show" }] });

		expect(mapMovieSummary(readyQueryResult(value))).toEqual({
			reason: "unsupported",
			status: "unavailable",
		});
		expect(movieSummaryUnavailable("unsupported").detail).toBe(
			"This entity is not a movie, and only movies can be opened here.",
		);
	});

	it("maps a decoded movie to the ready state", () => {
		const value = decodeMovieSummaryResult({
			movie: [movieSummaryRow],
			requested: [{ schemaSlug: "movie" }],
		});

		expect(mapMovieSummary(readyQueryResult(value))).toMatchObject({
			status: "ready",
			summary: { id: "movie-1", name: "Fight Club" },
		});
	});

	it("keeps error copy free of decoder and transport internals", () => {
		expect(movieSummaryError({ status: "malformed" })).toEqual({
			title: "Unable to display this movie",
			detail: "This movie returned data that could not be displayed. Try again later.",
		});
		expect(movieSummaryError({ status: "transport-error" }).detail).not.toContain("RyotQL");
		expect(movieSummaryUnavailable("missing").title).toBe("Movie unavailable");
	});

	it("labels every flat lifecycle state and never a caught up one", () => {
		expect(movieLifecycleLabel("untracked")).toBe("Not tracked");
		expect(movieLifecycleLabel("backlog")).toBe("In backlog");
		expect(movieLifecycleLabel("in_progress")).toBe("In progress");
		expect(movieLifecycleLabel("on_hold")).toBe("On hold");
		expect(movieLifecycleLabel("dropped")).toBe("Dropped");
		expect(movieLifecycleLabel("complete")).toBe("Complete");
	});

	it("reads the runtime fact as a duration and omits it when unrecorded", () => {
		expect(movieRuntimeFact(decodeMovieSummary())).toEqual({
			icon: "clock",
			value: "2h 49m",
			label: "Runtime",
		});
		expect(movieRuntimeFact(decodeMovieSummary({ runtime: null }))).toBeUndefined();
	});

	it("lists the rating, runtime and production status without season or episode facts", () => {
		expect(movieSummaryFacts(decodeMovieSummary()).map(({ label }) => label)).toEqual([
			"TMDB rating",
			"Runtime",
			"Production status",
		]);
	});

	it("drops the facts the provider never recorded", () => {
		const sparse = decodeMovieSummary({
			runtime: null,
			providerRating: null,
			productionStatus: null,
		});

		expect(movieSummaryFacts(sparse)).toEqual([]);
	});

	it("shows the status rail progress bar only while the movie is in progress", () => {
		expect(
			movieSummaryProgress(decodeMovieSummary({ progressPercent: 40, state: "in_progress" })),
		).toEqual({ percent: 40 });
		expect(
			movieSummaryProgress(decodeMovieSummary({ state: "complete", progressPercent: 40 })),
		).toBeUndefined();
		expect(
			movieSummaryProgress(decodeMovieSummary({ state: "in_progress", progressPercent: null })),
		).toBeUndefined();
	});
});
