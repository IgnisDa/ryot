// @vitest-environment jsdom

import { fireEvent, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import {
	decodeShowActivity,
	emptyShowActivity,
	firstWatchDayRow,
	rewatchedShowActivity,
	sameDayWatchRow,
} from "../../tests/client/show/activity-fixture";
import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "../../tests/client/show/query-result-fixture";
import { mountRyotClient } from "../../tests/client/show/test-support";
import { ShowActivity } from "./activity";
import { mapShowActivity, type ShowActivityState } from "./activity-state";

const noopAdapter = { query: () => Promise.resolve({}) };

const readyState = (input: Parameters<typeof decodeShowActivity>[0] = {}): ShowActivityState =>
	mapShowActivity(readyQueryResult(decodeShowActivity(input)));

const renderActivity = (
	state: ShowActivityState,
	refresh: () => void = () => undefined,
	compact = true,
) =>
	mountRyotClient(noopAdapter, <ShowActivity state={state} compact={compact} refresh={refresh} />);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("show activity tab", () => {
	it("renders the loading branch while the activity query is pending", () => {
		const { unmount, container } = renderActivity(mapShowActivity(pendingQueryResult()));

		expect(container.textContent).toContain("Loading activity...");
		expect(container.textContent).not.toContain("Coverage");
		unmount();
	});

	it("offers a retry from the transport error branch", () => {
		const retries: number[] = [];
		const { unmount, container } = renderActivity(
			mapShowActivity(transportErrorQueryResult()),
			() => retries.push(1),
		);

		const retry = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Try again",
		);
		if (retry === undefined) {
			throw new Error("Expected the activity retry button");
		}
		fireEvent.click(retry);

		expect(container.textContent).toContain("Unable to load activity");
		expect(retries).toEqual([1]);
		unmount();
	});

	it("hides decoder internals behind a stable malformed message", () => {
		const { unmount, container } = renderActivity(mapShowActivity(malformedQueryResult()));

		expect(container.textContent).toContain("Unable to load activity");
		unmount();
	});

	it("explains an unrecorded history and offers the deferred log control", () => {
		const { unmount, container } = renderActivity(
			mapShowActivity(readyQueryResult(emptyShowActivity())),
		);
		const log = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Log activity",
		);
		if (log === undefined) {
			throw new Error("Expected the Log activity button");
		}

		fireEvent.click(log);

		expect(container.textContent).toContain("No activity yet");
		expect(container.textContent).not.toContain("Coverage");
		unmount();
	});

	it("leads with the figures a reader opens the tab for", () => {
		const { unmount, container } = renderActivity(readyState());

		expect(container.textContent).toContain("Episodes");
		expect(container.textContent).toContain("2 / 4");
		expect(container.textContent).toContain("Watches");
		expect(container.textContent).toContain("Span");
		expect(container.textContent).toContain("8 days");
		expect(container.textContent).toContain("Nov 1 – Nov 8, 2025");
		unmount();
	});

	it("shows season coverage with specials on their own row", () => {
		const { unmount, container } = renderActivity(readyState());

		expect(container.textContent).toContain("Coverage");
		expect(container.textContent).toContain("Season 1");
		expect(container.textContent).toContain("2/4");
		expect(container.textContent).toContain("Specials");
		expect(container.textContent).toContain("0/2");
		unmount();
	});

	it("reads a day of watching as one entry listing its episodes", () => {
		const { unmount, container } = renderActivity(
			readyState({
				parentEvents: [],
				episodeEvents: [],
				episodeProgress: [],
				collectionEvents: [],
				watchDays: [firstWatchDayRow, sameDayWatchRow],
			}),
		);

		expect(container.textContent).toContain("Watched 2 episodes");
		expect(container.textContent).toContain("Episode 1: The Arrest");
		expect(container.textContent).toContain("Episode 2: The Interview");
		expect(container.textContent).toContain("Jellyfin");
		unmount();
	});

	it("names the finish and the collection changes in the same record", () => {
		const { unmount, container } = renderActivity(readyState());

		expect(container.textContent).toContain("Finished the show");
		expect(container.textContent).toContain("Added to the Watchlist collection");
		expect(container.textContent).toContain("Removed from the Watchlist collection");
		unmount();
	});

	it("separates watches only once a second one is completed", () => {
		const { unmount, container } = renderActivity(
			mapShowActivity(readyQueryResult(rewatchedShowActivity())),
		);

		expect(container.textContent).toContain("Watch 2 · Mar 2, 2026");
		expect(container.textContent).toContain("Watch 1 · Nov 6, 2025");
		unmount();
	});

	it("keeps a single watch free of separators", () => {
		const { unmount, container } = renderActivity(readyState());

		expect(container.textContent).not.toMatch(/Watch \d/);
		unmount();
	});

	it("keeps a spoiler review hidden until the reader asks for it", async () => {
		const { unmount, container } = renderActivity(readyState());
		const reveal = Array.from(container.querySelectorAll("button")).find(
			(button) => button.getAttribute("aria-label") === "Show spoiler review",
		);
		if (reveal === undefined) {
			throw new Error("Expected the spoiler reveal button");
		}

		expect(container.textContent).not.toContain("The arrest scene is the whole show.");

		fireEvent.click(reveal);

		await waitFor(() =>
			expect(container.textContent).toContain("The arrest scene is the whole show."),
		);
		expect(container.textContent).toContain("90 / 100");
		unmount();
	});

	it("shows a review without spoilers straight away", () => {
		const { unmount, container } = renderActivity(readyState());

		expect(container.textContent).toContain("82 / 100");
		expect(container.textContent).toContain("A devastating watch.");
		unmount();
	});

	it("says only recent activity is shown once the window is truncated", () => {
		const { unmount, container } = renderActivity(readyState({ truncated: true }));

		expect(container.textContent).toContain("Only your most recent activity is shown here.");
		expect(container.textContent).toContain("Latest");
		expect(container.textContent).not.toContain("Span");
		expect(container.textContent).not.toContain("8 days");
		unmount();
	});

	it("never surfaces identifiers or completion internals in the record", () => {
		const { unmount, container } = renderActivity(readyState());

		expect(container.textContent).not.toContain("episode-1");
		expect(container.textContent).not.toContain("show-complete");
		expect(container.textContent).not.toContain("completionMode");
		unmount();
	});

	it("leaves the record unchanged for the deferred complete history control", () => {
		const { unmount, container } = renderActivity(readyState());
		const viewHistory = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "View complete history",
		);
		if (viewHistory === undefined) {
			throw new Error("Expected the View complete history button");
		}

		fireEvent.click(viewHistory);

		expect(container.textContent).toContain("Finished the show");
		unmount();
	});
});
