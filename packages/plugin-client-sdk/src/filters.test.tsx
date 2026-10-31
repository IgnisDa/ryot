import { afterEach, describe, expect, it } from "@effect/vitest";
import { screen } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { activeFiltersPhrase, filtersLabel, ViewFiltersSheet } from "./filters";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

const renderSheet = (compact: boolean, title: string) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<ViewFiltersSheet title={title} compact={compact} onClose={() => undefined}>
				<p>Sheet body</p>
			</ViewFiltersSheet>,
		),
	);
};

describe("filter labels", () => {
	it("pluralizes the active filter phrase", () => {
		expect(activeFiltersPhrase(1)).toBe("1 active filter");
		expect(activeFiltersPhrase(0)).toBe("0 active filters");
		expect(filtersLabel(2)).toBe("Filters, 2 active filters");
	});
});

describe("ViewFiltersSheet", () => {
	afterEach(() => {
		act(() => roots.splice(0).forEach((root) => root.unmount()));
		document.body.replaceChildren();
	});

	it("titles the dialog and names its close control from the title", () => {
		renderSheet(false, "View options");
		expect(screen.getByRole("heading", { level: 2, name: "View options" })).toBeTruthy();
		expect(screen.getByRole("dialog", { name: "View options" })).toBeTruthy();
		expect(screen.getByText("Sheet body")).toBeTruthy();
		expect(screen.getAllByLabelText("Close view options").length).toBeGreaterThan(0);
	});

	it("anchors to the bottom edge when compact", () => {
		renderSheet(true, "Filters");
		expect(screen.getByRole("dialog", { name: "Filters" }).className).toContain("rounded-t-xl");
	});
});
