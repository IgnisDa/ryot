import { afterEach, describe, expect, it } from "@effect/vitest";
import { fireEvent, screen } from "@testing-library/dom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { CompletionToggle } from "./completion-toggle";

const roots: Root[] = [];

const mount = () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	return (node: ReactNode) => act(() => root.render(node));
};

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.innerHTML = "";
});

describe("CompletionToggle", () => {
	it("reports the complete variant's pressed state under a stable label", () => {
		const presses: Array<string> = [];
		const render = mount();
		render(
			<CompletionToggle
				pressed={false}
				icon={<span />}
				variant="complete"
				label="Complete set 1"
				onClick={() => presses.push("press")}
			/>,
		);

		const toggle = screen.getByRole("button", { pressed: false, name: "Complete set 1" });
		fireEvent.click(toggle);
		expect(presses).toEqual(["press"]);

		render(<CompletionToggle pressed icon={<span />} variant="complete" label="Complete set 1" />);
		expect(screen.getByRole("button", { pressed: true, name: "Complete set 1" })).toBe(toggle);
	});

	it("renders the start variant as a plain button", () => {
		mount()(
			<CompletionToggle
				pressed={false}
				variant="start"
				icon={<span />}
				label="Start set 1 timer"
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Start set 1 timer" }).hasAttribute("aria-pressed"),
		).toBe(false);
	});

	it("renders the include variant as a checkbox", () => {
		mount()(<CompletionToggle pressed icon={<span />} variant="include" label="Include set 2" />);

		expect(screen.getByRole("checkbox", { checked: true, name: "Include set 2" })).toBeTruthy();
	});
});
