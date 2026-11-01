import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusMessage } from "./status-message";

describe("StatusMessage", () => {
	it("announces the error tone as an alert", () => {
		render(<StatusMessage tone="error">Something failed</StatusMessage>);

		expect(screen.getByRole("alert").textContent).toBe("Something failed");
	});

	it.each(["pending", "success"] as const)("announces the %s tone as a status", (tone) => {
		render(<StatusMessage tone={tone}>Message</StatusMessage>);

		expect(screen.getByRole("status").textContent).toBe("Message");
	});

	it("keeps one live region element across a tone change so content changes are announced", () => {
		const { rerender } = render(<StatusMessage tone="pending">Requesting...</StatusMessage>);
		const region = screen.getByRole("status");

		rerender(<StatusMessage tone="success">Hello, Ryot</StatusMessage>);
		expect(screen.getByRole("status")).toBe(region);
		expect(region.textContent).toBe("Hello, Ryot");

		rerender(<StatusMessage tone="error">Unavailable</StatusMessage>);
		expect(screen.getByRole("alert")).toBe(region);
	});

	it("keeps caller classes", () => {
		render(
			<StatusMessage tone="success" className="mt-2">
				Done
			</StatusMessage>,
		);

		expect(screen.getByRole("status").classList.contains("mt-2")).toBe(true);
	});

	it("renders the action next to the message and reports its activation", () => {
		const activated: string[] = [];
		render(
			<StatusMessage
				tone="error"
				action={{ label: "Try again", onClick: () => activated.push("retry") }}
			>
				Unable to load.
			</StatusMessage>,
		);

		expect(screen.getByRole("alert").textContent).toBe("Unable to load.");
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(activated).toEqual(["retry"]);
	});

	it("disables the action on request", () => {
		render(
			<StatusMessage tone="pending" action={{ label: "Wait", disabled: true, onClick: () => {} }}>
				Counting
			</StatusMessage>,
		);

		expect(screen.getByRole("button", { name: "Wait" }).hasAttribute("disabled")).toBe(true);
	});

	it("renders no button without an action", () => {
		render(<StatusMessage tone="pending">Counting</StatusMessage>);

		expect(screen.queryByRole("button")).toBeNull();
	});
});
