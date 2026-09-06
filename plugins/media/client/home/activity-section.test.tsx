import { RyotClientError } from "@ryot-app/client-sdk";
import type { RyotQueryResult } from "@ryot-app/client-sdk/react";
import { getByRole, getByText } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import type { MediaActivity } from "../../shared/activity-recipes";
import {
	errorQueryResult,
	pendingQueryResult,
	readyQueryResult,
} from "../../tests/client/query-result-fixture";
import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { activityWindow } from "./activity-model";
import { ActivitySectionView } from "./activity-section";

const TODAY = "2026-09-25";
const TIME_ZONE = "America/New_York";
const noopAdapter = { query: () => Promise.resolve({}) };

const activity: MediaActivity = {
	figures: { reviews: 7, minutes: 5430, finished: 1204 },
	mediaTypes: [
		{ events: 995, slug: "show", label: "Show" },
		{ events: 5, slug: "book", label: "Book" },
	],
	days: [
		{ events: 1, day: "2026-09-21T04:00:00.000Z" },
		{ events: 4, day: "2026-09-23T04:00:00.000Z" },
		{ events: 2, day: "2026-09-24T04:00:00.000Z" },
		{ events: 1, day: "2026-09-25T04:00:00.000Z" },
	],
};

const mount = (result: RyotQueryResult<MediaActivity>) =>
	mountRyotClient(
		noopAdapter,
		<ActivitySectionView
			compact
			result={result}
			timeZone={TIME_ZONE}
			window={activityWindow(TODAY, TIME_ZONE)}
		/>,
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("ActivitySectionView", () => {
	it("shows a loading placeholder while the first result is pending", () => {
		const view = mount(pendingQueryResult());

		expect(getByRole(view.container, "status", { name: "Loading Your activity" })).toBeDefined();
		expect(view.container.querySelector("svg")).toBeNull();
		view.unmount();
	});

	it("retries the query from the error state", () => {
		let retries = 0;
		const view = mount({
			...errorQueryResult<MediaActivity>(new RyotClientError("transport")),
			refetch: () => {
				retries += 1;
			},
		});

		clickRyotElement(
			getByRole(getByRole(view.container, "alert"), "button", { name: "Try again" }),
		);

		expect(retries).toBe(1);
		view.unmount();
	});

	it("keeps showing the last activity when a refresh fails", () => {
		const view = mount(errorQueryResult(new RyotClientError("transport"), activity));

		expect(view.container.querySelector('[role="alert"]')).toBeNull();
		expect(getByText(view.container, "Finished")).toBeDefined();
		view.unmount();
	});

	it("renders the figures, a padded heatmap in the local time zone, and the type shares", () => {
		const view = mount(readyQueryResult(activity));
		const figure = (label: string) =>
			getByText(view.container, label).previousElementSibling?.textContent;

		expect(figure("Finished")).toBe("1,204");
		expect(figure("Hours")).toBe("91");
		expect(figure("Reviews")).toBe("7");
		expect(figure("Day streak")).toBe("3");

		const cells = view.container.querySelectorAll(".ts-chart__rect rect");
		expect(cells).toHaveLength(52 * 7 - 2);
		const fill = (date: string) =>
			view.container
				.querySelector(`.ts-chart__rect rect[data-ts-key$=":${date}"]`)
				?.getAttribute("fill");
		expect(fill("2026-09-23")).toBe("var(--chart-seq-5)");
		expect(fill("2026-09-22")).toBe("var(--chart-seq-0)");

		const bars = [...view.container.querySelectorAll("ol > li")].map((row) => row.textContent);
		expect(bars).toEqual(["Show100%", "Book<1%"]);
		view.unmount();
	});
});
