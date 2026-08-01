import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Modal } from "./modal";
import {
	OverlayBackProvider,
	OverlayScope,
	type OverlayBackAdapter,
	useShortcut,
} from "./shortcut";

function Page() {
	const [open, setOpen] = useState(false);
	const [fired, setFired] = useState(0);
	useShortcut("A", () => setFired((count) => count + 1));

	return (
		<>
			<p data-testid="fired">{fired}</p>
			<button type="button" onClick={() => setOpen(true)}>
				Open
			</button>
			{open && (
				<Modal closeLabel="Close" label="Overlay" onClose={() => setOpen(false)}>
					<button type="button">Inside</button>
				</Modal>
			)}
		</>
	);
}

const fired = () => screen.getByTestId("fired").textContent;

describe("OverlayScope", () => {
	it("registers document Back handlers in LIFO order", () => {
		const handlers: Array<() => boolean> = [];
		const adapter: OverlayBackAdapter = {
			register: (handler) => {
				handlers.push(handler);
				return () => {
					const index = handlers.indexOf(handler);
					if (index !== -1) {
						handlers.splice(index, 1);
					}
				};
			},
		};
		const dismissed: string[] = [];
		const view = render(
			<OverlayBackProvider adapter={adapter}>
				<OverlayScope onEscape={() => dismissed.push("outer")}>Outer</OverlayScope>
				<OverlayScope onEscape={() => dismissed.push("inner")}>Inner</OverlayScope>
			</OverlayBackProvider>,
		);

		expect(handlers.at(-1)?.()).toBe(true);
		expect(dismissed).toEqual(["inner"]);
		view.rerender(
			<OverlayBackProvider adapter={adapter}>
				<OverlayScope onEscape={() => dismissed.push("outer")}>Outer</OverlayScope>
			</OverlayBackProvider>,
		);
		expect(handlers.at(-1)?.()).toBe(true);
		expect(dismissed).toEqual(["inner", "outer"]);
	});

	it("routes Escape to the overlay that owns the scope", () => {
		let escapes = 0;
		render(
			<OverlayScope onEscape={() => (escapes += 1)}>
				<p>Content</p>
			</OverlayScope>,
		);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(escapes).toBe(1);
	});

	it("stays silent while it is disabled", () => {
		let escapes = 0;
		render(
			<OverlayScope enabled={false} onEscape={() => (escapes += 1)}>
				<p>Content</p>
			</OverlayScope>,
		);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(escapes).toBe(0);
	});

	it("suppresses a background shortcut while an overlay is open and restores it on close", () => {
		render(<Page />);

		fireEvent.keyDown(document, { key: "A" });

		expect(fired()).toBe("1");

		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		fireEvent.keyDown(document, { key: "A" });

		expect(fired()).toBe("1");
		expect(screen.getByRole("dialog")).toBeTruthy();

		fireEvent.keyDown(document, { key: "Escape" });
		fireEvent.keyDown(document, { key: "A" });

		expect(fired()).toBe("2");
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
