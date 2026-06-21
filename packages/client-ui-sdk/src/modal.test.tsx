import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { Modal } from "./modal";

function TriggeredModal(props: {
	readonly open?: boolean;
	readonly onClose: () => void;
	readonly onInterceptBack?: () => boolean;
}) {
	const trigger = useRef<HTMLButtonElement>(null);
	return (
		<>
			<button type="button" ref={trigger}>
				Open
			</button>
			{props.open === false ? null : (
				<Modal
					label="Confirm"
					triggerRef={trigger}
					closeLabel="Close dialog"
					onClose={props.onClose}
					onInterceptBack={props.onInterceptBack ?? (() => false)}
				>
					<button type="button">Cancel</button>
				</Modal>
			)}
		</>
	);
}

describe("Modal", () => {
	it("focuses its first control and restores focus to the trigger when it closes", async () => {
		const view = render(<TriggeredModal onClose={() => {}} />);

		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));

		const trigger = screen.getByRole("button", { name: "Open" });
		view.rerender(<TriggeredModal open={false} onClose={() => {}} />);
		await act(async () => {});

		expect(document.activeElement).toBe(trigger);
	});

	it("closes on Escape and on the scrim, and locks body scroll while open", () => {
		document.body.style.overflow = "auto";
		let closes = 0;
		const view = render(
			<TriggeredModal
				onClose={() => {
					closes += 1;
				}}
			/>,
		);
		expect(document.body.style.overflow).toBe("hidden");

		fireEvent.keyDown(document, { key: "Escape" });
		expect(closes).toBe(1);

		fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
		expect(closes).toBe(2);

		view.unmount();
		expect(document.body.style.overflow).toBe("auto");
	});

	it("closes only the topmost modal on Escape", () => {
		const closed: string[] = [];
		const view = render(
			<>
				<Modal label="Outer" closeLabel="Close outer" onClose={() => closed.push("outer")}>
					<button type="button">Outer action</button>
				</Modal>
				<Modal label="Inner" closeLabel="Close inner" onClose={() => closed.push("inner")}>
					<button type="button">Inner action</button>
				</Modal>
			</>,
		);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(closed).toEqual(["inner"]);

		view.rerender(
			<Modal label="Outer" closeLabel="Close outer" onClose={() => closed.push("outer")}>
				<button type="button">Outer action</button>
			</Modal>,
		);
		fireEvent.keyDown(document, { key: "Escape" });

		expect(closed).toEqual(["inner", "outer"]);
	});

	it("skips closing when the injected back interceptor handles the request", () => {
		let closes = 0;
		let intercepts = 0;
		render(
			<TriggeredModal
				onClose={() => {
					closes += 1;
				}}
				onInterceptBack={() => {
					intercepts += 1;
					return true;
				}}
			/>,
		);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(intercepts).toBe(1);
		expect(closes).toBe(0);
	});

	it("ignores dismissal while it is not dismissible", () => {
		let closes = 0;
		render(
			<Modal
				label="Pending"
				dismissible={false}
				closeLabel="Close pending"
				onClose={() => {
					closes += 1;
				}}
			>
				<button type="button">Cancel</button>
			</Modal>,
		);

		fireEvent.keyDown(document, { key: "Escape" });
		fireEvent.click(screen.getByRole("button", { name: "Close pending" }));

		expect(closes).toBe(0);
	});
});
