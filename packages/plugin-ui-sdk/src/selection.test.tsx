import { describe, expect, it } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { fireEvent, screen } from "@testing-library/react";

import { render } from "./i18n.test-support";
import { SelectableItem, SelectionBar } from "./selection";

describe("SelectableItem", () => {
	it("renders its content untouched outside selection mode", () => {
		render(
			<SelectableItem id="item-1" selection={undefined} label={testText("Dune")}>
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
				label={testText("Dune")}
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
		const actions = [
			{ icon: null, danger: true, label: testText("Remove"), run: () => runs.push("remove") },
		];
		const { rerender } = render(
			<SelectionBar
				disabled={false}
				actions={actions}
				safeAreaBottom={0}
				label={testText("2 selected")}
				onExit={() => runs.push("exit")}
				extend={{ run: () => runs.push("extend"), label: testText("Select all 9") }}
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
				safeAreaBottom={0}
				onExit={() => undefined}
				busy="Preparing selection..."
				label={testText("2 selected")}
				extend={{ run: () => undefined, label: testText("Select all 9") }}
			/>,
		);
		expect(screen.getByRole("status").textContent).toBe("Preparing selection...");
		expect(screen.queryByRole("button", { name: "Select all 9" })).toBeNull();
		expect(screen.getByRole("button", { name: "Remove" })).toHaveProperty("disabled", true);
	});
});
