import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { getByRole, queryByRole, queryByText } from "@testing-library/dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
	decodeEpisodicActivity,
	episodicFirstWatchDayRow,
} from "../../tests/client/episodic/activity-fixture";
import { episodicFixtureSchema } from "../../tests/client/episodic/schema-fixture";
import {
	decodeFlatActivity,
	flatProgressEventRow,
} from "../../tests/client/flat-media/activity-fixture";
import { fixtureSchema } from "../../tests/client/flat-media/schema-fixture";
import { readyQueryResult } from "../../tests/client/query-result-fixture";
import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { type MediaActivityRowRender, MediaActivityRows } from "./activity-rows";
import type { MediaActivityRowBase } from "./activity-timeline";

const adapter = { query: () => Effect.succeed({}) };

const watchDay = (number: number) => ({
	...episodicFirstWatchDayRow,
	episodeNumber: number,
	episodeId: `episode-${number}`,
	episodeName: `Episode ${number}`,
});

const renderEpisodic = (numbers: readonly number[]) =>
	mountRyotClient(
		adapter,
		<episodicFixtureSchema.Activity
			compact
			entityId="media-1"
			refresh={() => undefined}
			state={episodicFixtureSchema.mapActivity(
				readyQueryResult(
					decodeEpisodicActivity({
						parentEvents: [],
						episodeEvents: [],
						episodeProgress: [],
						collectionEvents: [],
						watchDays: numbers.map(watchDay),
					}),
				),
			)}
		/>,
	);

const progressAt = (minute: number, percent: number) => ({
	...flatProgressEventRow,
	progressPercent: percent,
	id: `progress-${minute}`,
	occurredAt: `2025-11-03T12:0${minute}:00.000Z`,
});

describe("activity timeline rendering", () => {
	it("summarises a long watch as ranges and reveals every episode on demand", () => {
		const episodes = [1, 2, 3, 4, 6].map(watchDay);
		const { unmount, container } = mountRyotClient(
			adapter,
			<episodicFixtureSchema.Activity
				compact
				entityId="media-1"
				refresh={() => undefined}
				state={episodicFixtureSchema.mapActivity(
					readyQueryResult(
						decodeEpisodicActivity({
							parentEvents: [],
							episodeEvents: [],
							episodeProgress: [],
							collectionEvents: [],
							watchDays: episodes.toReversed(),
						}),
					),
				)}
			/>,
		);

		expect(container.textContent).toContain("Heard 5 episodes");
		expect(container.textContent).toContain("Ep 1 – Ep 4, Ep 6");
		expect(container.textContent).not.toContain("Episode 3");
		const toggle = getByRole(container, "button", { name: "Show 5 episodes" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");

		clickRyotElement(toggle);

		expect(getByRole(container, "button", { name: "Hide episodes" })).toBeTruthy();
		expect(container.textContent).toContain("Episode 3");
		unmount();
	});

	it("lists a short watch inline without an expand control", () => {
		const { unmount, container } = renderEpisodic([1, 2]);

		expect(container.textContent).toContain("Episode 2");
		expect(queryByRole(container, "button", { name: /episodes/ })).toBeNull();
		unmount();
	});

	it("shows a progress run as its newest label with the update count", () => {
		const { unmount, container } = mountRyotClient(
			adapter,
			<fixtureSchema.Activity
				compact
				entityId="media-1"
				refresh={() => undefined}
				state={fixtureSchema.mapActivity(
					readyQueryResult(
						decodeFlatActivity({
							completionCount: 0,
							consumedAmount: null,
							collectionEvents: [],
							events: [progressAt(1, 10), progressAt(2, 55), progressAt(3, 98.99)],
						}),
					),
				)}
			/>,
		);

		expect(container.textContent).toContain("98.99% through the item");
		expect(container.textContent).toContain("3 updates since 10%");
		expect(container.textContent).not.toContain("55% through the item");
		expect(container.textContent).toContain("Progress98.99%");
		expect(container.textContent).not.toContain("0 Reads");
		unmount();
	});
});

type Row = MediaActivityRowBase & { readonly label: string };

const row = (day: string): Row => ({
	type: "beat",
	dateKey: day,
	key: `beat-${day}`,
	label: `Logged ${day}`,
	occurredAt: `${day}T12:00:00.000Z`,
});

const render: MediaActivityRowRender<Row> = {
	segmentNoun: "Pass",
	rowBody: () => null,
	rowSource: () => undefined,
	rowLabel: (entry) => entry.label,
	monthSummary: (rows) => `${rows.length} logs`,
};

const julyDays = ["2026-07-26", "2026-07-20", "2026-07-11", "2026-07-02"];
const juneDays = ["2026-06-28", "2026-06-21", "2026-06-14", "2026-06-07", "2026-06-01"];

const mountRows = (rows: readonly Row[], monthly: undefined | { readonly openNewest: boolean }) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() =>
		root.render(<MediaActivityRows compact rows={rows} render={render} monthly={monthly} />),
	);
	return container;
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("monthly activity rows", () => {
	it("folds a long history into months with only the newest month open", () => {
		const container = mountRows([...julyDays, ...juneDays].map(row), { openNewest: true });

		const july = getByRole(container, "button", { name: /July 2026/ });
		const june = getByRole(container, "button", { name: /June 2026/ });
		expect(july.getAttribute("aria-expanded")).toBe("true");
		expect(june.getAttribute("aria-expanded")).toBe("false");
		expect(june.textContent).toContain("5 logs · 5 days");
		expect(queryByText(container, "Logged 2026-07-26")).not.toBeNull();
		expect(queryByText(container, "Logged 2026-06-28")).toBeNull();

		act(() => june.click());

		expect(june.getAttribute("aria-expanded")).toBe("true");
		expect(queryByText(container, "Logged 2026-06-28")).not.toBeNull();
	});

	it("keeps short or unmonthly histories as plain day groups", () => {
		const short = mountRows(
			[julyDays[0], juneDays[0]].flatMap((day) => (day ? [row(day)] : [])),
			{ openNewest: true },
		);
		expect(short.querySelector("button[aria-expanded]")).toBeNull();

		const unmonthly = mountRows([...julyDays, ...juneDays].map(row), undefined);
		expect(unmonthly.querySelector("button[aria-expanded]")).toBeNull();
		expect(queryByText(unmonthly, "Logged 2026-06-01")).not.toBeNull();
	});
});
