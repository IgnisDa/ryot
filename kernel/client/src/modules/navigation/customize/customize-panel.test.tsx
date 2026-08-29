import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { CustomizePanel } from "#/modules/navigation/customize/customize-panel";
import {
	moveCustomizeItem,
	toggleCustomizeItem,
	type CustomizeDraft,
} from "#/modules/navigation/customize/customize-state";

const item = (slug: string, pluginSlug: string | null, isDisabled = false) => ({
	slug,
	isDisabled,
	pluginSlug,
	icon: "list",
	name: slug.toUpperCase(),
});

const draft: CustomizeDraft = {
	savedViews: [item("recent", null)],
	views: [item("shows", "media"), item("movies", "media", true)],
};

function Harness(props: { readonly initial?: CustomizeDraft }) {
	const [current, setCurrent] = useState(props.initial ?? draft);
	return (
		<CustomizePanel
			draft={current}
			onToggle={(section, slug) =>
				setCurrent((value) => toggleCustomizeItem({ draft: value, section, slug }))
			}
			onMove={(section, fromIndex, toIndex) =>
				setCurrent((value) => moveCustomizeItem({ draft: value, section, fromIndex, toIndex }))
			}
		/>
	);
}

describe("CustomizePanel", () => {
	it("counts the pinned Home row in the Views heading", () => {
		render(<Harness />);

		expect(screen.getByText("Views · 2 of 3 shown")).toBeDefined();
		expect(screen.getByText("Saved Views · 1 of 1 shown")).toBeDefined();
	});

	it("shows Home as pinned and gives it no visibility switch", () => {
		render(<Harness />);

		expect(screen.getByText("Always shown")).toBeDefined();
		expect(screen.queryByRole("switch", { name: "Show Home in sidebar" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Reorder Home" })).toBeNull();
	});

	it("reflects a hidden view in its switch and updates the count when toggled", () => {
		render(<Harness />);

		const shows = screen.getByRole("switch", { name: "Show SHOWS in sidebar" });
		expect(screen.getByRole("switch", { name: "Show MOVIES in sidebar" }).ariaChecked).toBe(
			"false",
		);

		fireEvent.click(shows);

		expect(screen.getByText("Views · 1 of 3 shown")).toBeDefined();
	});

	it("reorders a section with the keyboard", () => {
		render(<Harness />);

		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder SHOWS" }), { key: "ArrowDown" });

		expect(screen.getByRole("list", { name: "Views" }).textContent).toMatch(/MOVIES.*SHOWS/);
	});

	it("explains that collections are not customizable", () => {
		render(<Harness />);

		expect(
			screen.getByText(
				"Collections are always shown and are not included in sidebar customization.",
			),
		).toBeDefined();
	});

	it("shows the saved views empty state while keeping the pinned Home row", () => {
		render(<Harness initial={{ views: [], savedViews: [] }} />);

		expect(screen.getByText("No saved views yet.")).toBeDefined();
		expect(screen.getByText("Views · 1 of 1 shown")).toBeDefined();
	});

	it("passes an axe pass", async () => {
		render(<Harness />);

		const results = await axe(document.body, {
			rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
		});

		expect(results.violations.map((violation) => violation.id)).toEqual([]);
	});
});
