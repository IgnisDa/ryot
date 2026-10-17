import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SplitButton } from "./split-button";

describe("SplitButton", () => {
	it("runs the primary action and exposes secondary actions in a menu", () => {
		const calls: string[] = [];
		render(
			<SplitButton
				menuIcon="▾"
				menuLabel="More logging options"
				onClick={() => calls.push("primary")}
				items={[{ key: "log", label: "Log activity…", onSelect: () => calls.push("log") }]}
			>
				Mark S5·E1 watched
			</SplitButton>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Mark S5·E1 watched" }));
		fireEvent.click(screen.getByRole("button", { name: "More logging options" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Log activity…" }));

		expect(calls).toEqual(["primary", "log"]);
	});

	it("disables both halves while the primary action is loading", () => {
		render(
			<SplitButton loading items={[]} menuIcon="▾" menuLabel="More">
				Save
			</SplitButton>,
		);
		const buttons = screen.getAllByRole("button");
		expect(buttons.every((button) => button.hasAttribute("disabled"))).toBe(true);
	});
});
