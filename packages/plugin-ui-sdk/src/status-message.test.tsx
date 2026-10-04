import { render, screen } from "@testing-library/react";
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
});
