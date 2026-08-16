import { fireEvent, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import {
	decodeMovieActivity,
	movieProgressEventRow,
} from "../../tests/client/movie/activity-fixture";
import {
	decodeMovieOverview,
	movieGroupRow,
	moviePersonRow,
} from "../../tests/client/movie/overview-fixture";
import {
	decodeMovieSummaryResult,
	movieSummaryRow,
} from "../../tests/client/movie/summary-fixture";
import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
} from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { mapMediaOverview, type MediaOverviewState } from "../media/overview-state";
import { MovieActivity } from "./activity";
import { mapMovieActivity } from "./activity-state";
import type { MovieOverview } from "./overview";
import { MovieScreenBody } from "./screen";
import { mapMovieSummary, type MovieSummaryState } from "./summary-state";

const noopAdapter = { query: () => Promise.resolve({}) };

const overviewState = (
	rows: Parameters<typeof decodeMovieOverview>[0] = {},
): MediaOverviewState<MovieOverview> =>
	mapMediaOverview(readyQueryResult(decodeMovieOverview(rows)));

const readyState = (overrides: Record<string, unknown> = {}): MovieSummaryState =>
	mapMovieSummary(
		readyQueryResult(
			decodeMovieSummaryResult({
				requested: [{ schemaSlug: "movie" }],
				movie: [{ ...movieSummaryRow, ...overrides }],
			}),
		),
	);

const activityTab = (
	<MovieActivity
		compact
		refresh={() => undefined}
		state={mapMovieActivity(readyQueryResult(decodeMovieActivity()))}
	/>
);

const renderContent = (
	state: MovieSummaryState,
	options: {
		readonly refresh?: () => void;
		readonly overview?: MediaOverviewState<MovieOverview>;
	} = {},
) =>
	mountRyotClient(
		noopAdapter,
		<MovieScreenBody
			compact
			state={state}
			safeAreaTop={0}
			settled={undefined}
			activity={activityTab}
			refreshOverview={() => undefined}
			overview={options.overview ?? overviewState()}
			refresh={options.refresh ?? (() => undefined)}
		/>,
	);

const tab = (container: HTMLElement, label: string) => {
	const found = Array.from(container.querySelectorAll('[role="tab"]')).find(
		(element) => element.textContent === label,
	);
	if (found === undefined) {
		throw new Error(`Expected a ${label} tab`);
	}
	return found;
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("movie screen", () => {
	it("offers exactly the overview and activity tabs", () => {
		const { unmount, container } = renderContent(readyState());

		expect(
			Array.from(container.querySelectorAll('[role="tab"]')).map(({ textContent }) => textContent),
		).toEqual(["Overview", "Activity"]);
		unmount();
	});

	it("names the movie, its provider, release year and genres in the identity line", () => {
		const { unmount, container } = renderContent(readyState());

		expect(container.textContent).toContain("Movie");
		expect(container.textContent).toContain("TMDB");
		expect(container.textContent).toContain("1999");
		expect(container.textContent).toContain("Drama");
		unmount();
	});

	it("shows the runtime and production status without season or episode facts", () => {
		const { unmount, container } = renderContent(readyState());

		expect(container.textContent).toContain("Runtime");
		expect(container.textContent).toContain("Production status");
		expect(container.textContent).not.toContain("Seasons");
		expect(container.textContent).not.toContain("Episodes");
		unmount();
	});

	it("shows the flat lifecycle label on the status rail", () => {
		const { unmount, container } = renderContent(readyState());

		expect(container.textContent).toContain("Your status");
		expect(container.textContent).toContain("Complete");
		unmount();
	});

	it("renders the status rail progress bar only while the movie is in progress", () => {
		const complete = renderContent(readyState());
		expect(complete.container.querySelector(".bg-success.rounded-pill")).toBeNull();
		complete.unmount();

		const inProgress = renderContent(readyState({ progressPercent: 40, state: "in_progress" }));
		const bar = inProgress.container.querySelector<HTMLElement>(".bg-success.rounded-pill");
		expect(bar?.style.width).toBe("40%");
		inProgress.unmount();
	});

	it("switches to the activity tab on demand", async () => {
		const { unmount, container } = renderContent(readyState());

		const selected = tab(container, "Activity");
		fireEvent.click(selected);

		await waitFor(() => expect(selected.getAttribute("aria-selected")).toBe("true"));
		expect(container.querySelector('[aria-label="Watch record"]')).not.toBeNull();
		expect(container.textContent).toContain(`${movieProgressEventRow.progressPercent}% through`);
		expect(container.textContent).not.toContain("Cast & crew");
		unmount();
	});

	it("shows the collection rail on the overview tab", () => {
		const { unmount, container } = renderContent(readyState());

		expect(container.textContent).toContain(moviePersonRow.name);
		expect(container.textContent).toContain(`Part of ${movieGroupRow.name}`);
		unmount();
	});

	it("explains that only movies open here when the entity is another schema", () => {
		const state = mapMovieSummary(
			readyQueryResult(
				decodeMovieSummaryResult({ movie: [], requested: [{ schemaSlug: "show" }] }),
			),
		);
		const { unmount, container } = renderContent(state);

		expect(container.textContent).toContain("Movie unavailable");
		expect(container.textContent).toContain("only movies can be opened here");
		unmount();
	});

	it("waits on a pending summary and retries a malformed one", () => {
		const loading = renderContent(mapMovieSummary(pendingQueryResult()));
		expect(loading.container.textContent).toContain("Loading movie...");
		loading.unmount();

		let refreshCount = 0;
		const failed = renderContent(mapMovieSummary(malformedQueryResult()), {
			refresh: () => {
				refreshCount += 1;
			},
		});
		expect(failed.container.textContent).toContain("Unable to display this movie");
		const retry = Array.from(failed.container.querySelectorAll("button")).find(
			(button) => button.textContent === "Try again",
		);
		if (retry === undefined) {
			throw new Error("Expected the summary retry button");
		}
		fireEvent.click(retry);
		expect(refreshCount).toBe(1);
		failed.unmount();
	});
});
