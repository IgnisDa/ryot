import { describe, expect, it } from "bun:test";

import { fireEvent, render, screen } from "@testing-library/react";

import { SelectableItem, SelectionBar } from "./selection";

describe("SelectableItem", () => {
	it("renders its content untouched outside selection mode", () => {
		render(
			<SelectableItem id="item-1" label="Dune" selection={undefined}>
				<a href="/dune">Dune</a>
			</SelectableItem>,
		);

		expect(screen.getByRole("link", { name: "Dune" }).closest("[inert]")).toBeNull();
		expect(screen.queryByRole("checkbox")).toBeNull();
	});

	it("covers its inert content with a toggle that reports the selected state", () => {
		const toggled: string[] = [];
		render(
			<SelectableItem
				id="item-1"
				label="Dune"
				selection={{ toggle: (id) => toggled.push(id), isSelected: (id) => id === "item-1" }}
			>
				<a href="/dune">Dune</a>
			</SelectableItem>,
		);

		const toggle = screen.getByRole("checkbox", { name: "Select Dune" });
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("link", { name: "Dune" }).closest("[inert]")).not.toBeNull();
		fireEvent.click(toggle);
		expect(toggled).toEqual(["item-1"]);
	});
});

describe("SelectionBar", () => {
	it("replaces its label and hides the extend link while busy", () => {
		const runs: string[] = [];
		const actions = [{ icon: null, danger: true, label: "Remove", run: () => runs.push("remove") }];
		const { rerender } = render(
			<SelectionBar
				disabled={false}
				actions={actions}
				label="2 selected"
				safeAreaBottom={0}
				onExit={() => runs.push("exit")}
				extend={{ label: "Select all 9", run: () => runs.push("extend") }}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Select all 9" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		fireEvent.click(screen.getByRole("button", { name: "Done" }));
		expect(runs).toEqual(["extend", "remove", "exit"]);

		rerender(
			<SelectionBar
				disabled={false}
				actions={actions}
				label="2 selected"
				safeAreaBottom={0}
				onExit={() => undefined}
				busy="Preparing selection..."
				extend={{ run: () => undefined, label: "Select all 9" }}
			/>,
		);
		expect(screen.getByRole("status").textContent).toBe("Preparing selection...");
		expect(screen.queryByRole("button", { name: "Select all 9" })).toBeNull();
		expect(screen.getByRole("button", { name: "Remove" })).toHaveProperty("disabled", true);
	});
});
