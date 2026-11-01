import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field, TextField } from "./text-field";

describe("Field", () => {
	it("labels its control and describes it with the error before the hint", () => {
		render(
			<Field
				label="Webhook URL"
				error="Use an https:// address."
				hint="Must be reachable from the server."
			>
				{(control) => <TextField {...control} invalid={control.invalid} />}
			</Field>,
		);

		const input = screen.getByRole("textbox", { name: "Webhook URL" });
		expect(input.getAttribute("aria-invalid")).toBe("true");
		const describedBy = (input.getAttribute("aria-describedby") ?? "").split(" ");
		expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toEqual([
			"Use an https:// address.",
			"Must be reachable from the server.",
		]);
		expect(screen.getByRole("alert").textContent).toBe("Use an https:// address.");
	});

	it("leaves a valid control undescribed when there is no hint", () => {
		render(
			<Field label="Display name">
				{(control) => <TextField {...control} invalid={control.invalid} />}
			</Field>,
		);

		const input = screen.getByRole("textbox", { name: "Display name" });
		expect(input.hasAttribute("aria-describedby")).toBe(false);
		expect(input.getAttribute("aria-invalid")).toBe("false");
	});
});
