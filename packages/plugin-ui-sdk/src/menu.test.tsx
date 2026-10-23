import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import { Menu, type MenuItem } from "./menu";

function MenuHarness(props: {
	readonly items: ReadonlyArray<MenuItem>;
	readonly onClose: (restoreFocus: boolean) => void;
}) {
	const trigger = useRef<HTMLButtonElement>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	return (
		<>
			<button type="button" ref={trigger}>
				Actions
			</button>
			<div data-testid="outside">outside</div>
			<Menu
				items={props.items}
				label="User actions"
				triggerRef={trigger}
				onClose={props.onClose}
				activeIndex={activeIndex}
				onActiveIndexChange={setActiveIndex}
			/>
		</>
	);
}

const items: ReadonlyArray<MenuItem> = [
	{ key: "password", onSelect: () => {}, label: "Send password reset" },
	{ disabled: true, key: "disabled", onSelect: () => {}, label: "Disable user" },
	{ key: "delete", destructive: true, onSelect: () => {}, label: "Delete user" },
];

describe("Menu", () => {
	it("focuses the active item and skips disabled items while arrowing", () => {
		render(<MenuHarness items={items} onClose={() => {}} />);

		const first = screen.getByRole("menuitem", { name: "Send password reset" });
		const last = screen.getByRole("menuitem", { name: "Delete user" });
		expect(document.activeElement).toBe(first);

		fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
		expect(document.activeElement).toBe(last);
		expect(last.getAttribute("tabindex")).toBe("0");
		expect(first.getAttribute("tabindex")).toBe("-1");

		fireEvent.keyDown(screen.getByRole("menu"), { key: "Home" });
		expect(document.activeElement).toBe(first);
	});

	it("closes without restoring focus when a pointer lands outside", () => {
		const closes: boolean[] = [];
		render(<MenuHarness items={items} onClose={(restore) => closes.push(restore)} />);

		fireEvent.pointerDown(screen.getByTestId("outside"));

		expect(closes).toEqual([false]);
	});

	it("stays open when a pointer lands inside the menu or on the trigger", () => {
		const closes: boolean[] = [];
		render(<MenuHarness items={items} onClose={(restore) => closes.push(restore)} />);

		fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Delete user" }));
		fireEvent.pointerDown(screen.getByRole("button", { name: "Actions" }));

		expect(closes).toEqual([]);
	});

	it("closes on Escape and restores focus to the trigger", () => {
		const closes: boolean[] = [];
		render(<MenuHarness items={items} onClose={(restore) => closes.push(restore)} />);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(closes).toEqual([true]);
	});

	it("lets an injected back interceptor consume the close request", () => {
		let intercepts = 0;
		const closes: boolean[] = [];
		const trigger = { current: null };
		render(
			<Menu
				items={items}
				activeIndex={0}
				label="User actions"
				triggerRef={trigger}
				onActiveIndexChange={() => {}}
				onClose={(restore) => closes.push(restore)}
				onInterceptBack={() => {
					intercepts += 1;
					return true;
				}}
			/>,
		);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(intercepts).toBe(1);
		expect(closes).toEqual([]);
	});
});
