import { describe, expect, it } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import { render } from "./i18n.test-support";
import { tabId, Tabs } from "./tabs";

function Harness() {
	const [value, setValue] = useState<"reviews" | "activity" | "overview">("overview");
	return (
		<>
			<Tabs
				value={value}
				panelId="panel"
				onChange={setValue}
				label={testText("Sections")}
				options={[
					{ value: "overview", label: testText("Overview") },
					{ value: "activity", label: testText("Activity") },
					{ value: "reviews", label: testText("Reviews") },
				]}
			/>
			<div id="panel" role="tabpanel" aria-labelledby={tabId("panel", value)} />
		</>
	);
}

describe("Tabs", () => {
	it("links only the selected tab to the panel and keeps one tab stop", () => {
		render(<Harness />);

		const overview = screen.getByRole("tab", { name: "Overview" });
		expect(overview.getAttribute("aria-selected")).toBe("true");
		expect(overview.getAttribute("aria-controls")).toBe("panel");
		expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-controls")).toBeNull();
		expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex"))).toEqual([
			"0",
			"-1",
			"-1",
		]);
		expect(screen.getByRole("tabpanel", { name: "Overview" })).toBeTruthy();
	});

	it("selects and focuses with wrapping arrows and Home/End", () => {
		render(<Harness />);

		fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), { key: "ArrowLeft" });
		expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Reviews" }));
		expect(screen.getByRole("tabpanel", { name: "Reviews" })).toBeTruthy();

		fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowRight" });
		expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Overview" }));

		fireEvent.keyDown(document.activeElement ?? document.body, { key: "End" });
		expect(screen.getByRole("tab", { name: "Reviews" }).getAttribute("aria-selected")).toBe("true");

		fireEvent.keyDown(document.activeElement ?? document.body, { key: "Home" });
		expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
			"true",
		);
	});
});
