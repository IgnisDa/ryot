import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialog } from "./dialog";

const renderSheet = (props: { readonly dismissible: boolean; readonly onClose: () => void }) =>
	render(
		<Dialog
			title="Set 1"
			placement="sheet"
			safeAreaBottom={34}
			closeLabel="Close set"
			onClose={props.onClose}
			dismissible={props.dismissible}
			footer={<button type="button">Done</button>}
		>
			<p>Set options</p>
		</Dialog>,
	);

describe("Dialog sheet placement", () => {
	it("labels the sheet and pads its footer above the bottom safe area", () => {
		renderSheet({ dismissible: true, onClose: () => {} });

		const dialog = screen.getByRole("dialog", { name: "Set 1" });
		const footer = screen.getByRole("button", { name: "Done" }).parentElement;
		expect(dialog.contains(footer)).toBe(true);
		expect(footer?.style.paddingBottom).toBe("46px");
	});

	it("closes on Escape when dismissible", () => {
		const closes: Array<string> = [];
		renderSheet({ dismissible: true, onClose: () => closes.push("close") });

		fireEvent.keyDown(screen.getByRole("dialog", { name: "Set 1" }), { key: "Escape" });
		expect(closes).toEqual(["close"]);
	});

	it("stays open on Escape when not dismissible", () => {
		const closes: Array<string> = [];
		renderSheet({ dismissible: false, onClose: () => closes.push("close") });

		fireEvent.keyDown(screen.getByRole("dialog", { name: "Set 1" }), { key: "Escape" });
		expect(closes).toEqual([]);
		expect(screen.getByRole("dialog", { name: "Set 1" })).toBeTruthy();
	});
});

describe("Dialog close button", () => {
	it("shows a close button beside the backdrop by default and omits it for a null icon", () => {
		const closes: Array<string> = [];
		const { rerender } = render(
			<Dialog title="Sheet" closeLabel="Close sheet" onClose={() => closes.push("close")} />,
		);

		expect(screen.getAllByRole("button", { name: "Close sheet" })).toHaveLength(2);
		fireEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", { name: "Close sheet" }),
		);
		expect(closes).toEqual(["close"]);

		rerender(<Dialog title="Sheet" closeIcon={null} onClose={() => {}} closeLabel="Close sheet" />);
		expect(screen.getAllByRole("button", { name: "Close sheet" })).toHaveLength(1);
	});
});
