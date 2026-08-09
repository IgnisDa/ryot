import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Modal } from "./modal";
import { OverlayScope, useShortcut } from "./shortcut";

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
