import { getByRole, queryByText } from "@testing-library/dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { type MediaActivityRowRender, MediaActivityRows } from "./activity-rows";
import type { MediaActivityRowBase } from "./activity-timeline";

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

const mount = (rows: readonly Row[], monthly: { readonly openNewest: boolean } | undefined) => {
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

describe("media activity rows", () => {
	it("folds a long history into months with only the newest month open", () => {
		const container = mount([...julyDays, ...juneDays].map(row), { openNewest: true });

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
		const short = mount(
			[julyDays[0], juneDays[0]].flatMap((day) => (day ? [row(day)] : [])),
			{ openNewest: true },
		);
		expect(short.querySelector("button[aria-expanded]")).toBeNull();

		const unmonthly = mount([...julyDays, ...juneDays].map(row), undefined);
		expect(unmonthly.querySelector("button[aria-expanded]")).toBeNull();
		expect(queryByText(unmonthly, "Logged 2026-06-01")).not.toBeNull();
	});
});
