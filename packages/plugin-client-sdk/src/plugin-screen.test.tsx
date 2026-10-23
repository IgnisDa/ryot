import { afterEach, describe, expect, it } from "@effect/vitest";
import { screen } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ViewFiltersButton } from "./plugin-screen";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

const renderButton = (activeCount: number) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => root.render(<ViewFiltersButton activeCount={activeCount} onClick={() => undefined} />));
};

describe("ViewFiltersButton", () => {
	afterEach(() => {
		act(() => roots.splice(0).forEach((root) => root.unmount()));
		document.body.replaceChildren();
	});

	it.each([
		[0, "Filters, 0 active filters"],
		[1, "Filters, 1 active filter"],
		[3, "Filters, 3 active filters"],
	])("shows %i active filters in its badge and accessible name", (count, label) => {
		renderButton(count);
		const button = screen.getByRole("button", { name: label });
		expect(button.textContent).toBe(`Filters${count}`);
	});
});
