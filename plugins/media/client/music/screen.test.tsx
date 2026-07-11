import { fireEvent, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import {
	decodeMusicActivity,
	musicProgressEventRow,
} from "../../tests/client/music/activity-fixture";
import {
	decodeMusicOverview,
	musicGroupRow,
	musicPersonRow,
} from "../../tests/client/music/overview-fixture";
import {
	decodeMusicSummaryResult,
	musicSummaryRow,
} from "../../tests/client/music/summary-fixture";
import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
} from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { mapMediaOverview, type MediaOverviewState } from "../media/overview-state";
import { MusicActivity } from "./activity";
import { mapMusicActivity } from "./activity-state";
import type { MusicOverview } from "./overview";
import { MusicScreenBody } from "./screen";
import { mapMusicSummary, type MusicSummaryState } from "./summary-state";

const noopAdapter = { query: () => Promise.resolve({}) };

const overviewState = (
	rows: Parameters<typeof decodeMusicOverview>[0] = {},
): MediaOverviewState<MusicOverview> =>
	mapMediaOverview(readyQueryResult(decodeMusicOverview(rows)));

const readyState = (overrides: Record<string, unknown> = {}): MusicSummaryState =>
	mapMusicSummary(
		readyQueryResult(
			decodeMusicSummaryResult({
				requested: [{ schemaSlug: "music" }],
				music: [{ ...musicSummaryRow, ...overrides }],
			}),
		),
	);

const activityTab = (
	<MusicActivity
		compact
		refresh={() => undefined}
		state={mapMusicActivity(readyQueryResult(decodeMusicActivity()))}
	/>
);

const renderContent = (
	state: MusicSummaryState,
	options: {
		readonly refresh?: () => void;
		readonly overview?: MediaOverviewState<MusicOverview>;
	} = {},
) =>
	mountRyotClient(
		noopAdapter,
		<MusicScreenBody
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

describe("music screen", () => {
	it("offers exactly the overview and activity tabs", () => {
		const { unmount, container } = renderContent(readyState());

		expect(
			Array.from(container.querySelectorAll('[role="tab"]')).map(({ textContent }) => textContent),
		).toEqual(["Overview", "Activity"]);
		unmount();
	});

	it("names the track, its provider, release year and genres in the identity line", () => {
		const { unmount, container } = renderContent(readyState());

		expect(container.textContent).toContain("Music");
		expect(container.textContent).toContain("MusicBrainz");
		expect(container.textContent).toContain("1997");
		expect(container.textContent).toContain("Art Rock");
		unmount();
	});

	it("shows only the facts the music schema declares", () => {
		const { unmount, container } = renderContent(readyState());

		expect(container.textContent).toContain("Length");
		expect(container.textContent).toContain("3:42");
		expect(container.textContent).toContain("Various artists");
		expect(container.textContent).toContain("Production status");
		expect(container.textContent).not.toContain("Runtime");
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

	it("renders the status rail progress bar only while the track is in progress", () => {
		const complete = renderContent(readyState());
		expect(complete.container.querySelector(".bg-success.rounded-pill")).toBeNull();
		complete.unmount();

		const inProgress = renderContent(readyState({ progressPercent: 40, state: "in_progress" }));
		expect(
			inProgress.container.querySelector<HTMLElement>(".bg-success.rounded-pill")?.style.width,
		).toBe("40%");
		inProgress.unmount();
	});

	it("switches to the activity tab on demand", async () => {
		const { unmount, container } = renderContent(readyState());

		const selected = tab(container, "Activity");
		fireEvent.click(selected);

		await waitFor(() => expect(selected.getAttribute("aria-selected")).toBe("true"));
		expect(container.querySelector('[aria-label="Listen record"]')).not.toBeNull();
		expect(container.textContent).toContain(`${musicProgressEventRow.progressPercent}% through`);
		unmount();
	});

	it("shows the album rail and no watch providers on the overview tab", () => {
		const { unmount, container } = renderContent(readyState());

		expect(container.textContent).toContain(musicPersonRow.name);
		expect(container.textContent).toContain(`Part of ${musicGroupRow.name}`);
		expect(container.textContent).not.toContain("Where to watch");
		unmount();
	});

	it("explains that only tracks open here when the entity is another schema", () => {
		const { unmount, container } = renderContent(
			mapMusicSummary(
				readyQueryResult(
					decodeMusicSummaryResult({ music: [], requested: [{ schemaSlug: "movie" }] }),
				),
			),
		);

		expect(container.textContent).toContain("Music unavailable");
		expect(container.textContent).toContain("only tracks can be opened here");
		unmount();
	});

	it("waits on a pending summary and retries a malformed one", () => {
		const loading = renderContent(mapMusicSummary(pendingQueryResult()));
		expect(loading.container.textContent).toContain("Loading track...");
		loading.unmount();

		let refreshCount = 0;
		const failed = renderContent(mapMusicSummary(malformedQueryResult()), {
			refresh: () => {
				refreshCount += 1;
			},
		});
		expect(failed.container.textContent).toContain("Unable to display this track");
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
