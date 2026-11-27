import { describe, expect, it } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import { render } from "./i18n.test-support";
import { Modal } from "./modal";
import { useShortcut } from "./shortcut";

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
			<Modal open={open} label={testText("Overlay")} onClose={() => setOpen(false)}>
				<button type="button">Inside</button>
			</Modal>
		</>
	);
}

const fired = () => screen.getByTestId("fired").textContent;

describe("overlay shortcuts", () => {
	it("suppresses a background shortcut while an overlay is open and restores it on close", () => {
		render(<Page />);

		fireEvent.keyDown(document, { key: "A" });

		expect(fired()).toBe("1");

		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		fireEvent.keyDown(document, { key: "A" });

		expect(fired()).toBe("1");
		expect(screen.getByRole("dialog")).toBeTruthy();

		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		fireEvent.keyDown(document, { key: "A" });

		expect(fired()).toBe("2");
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
