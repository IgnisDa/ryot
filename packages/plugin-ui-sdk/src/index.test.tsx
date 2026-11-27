import { describe, expect, it } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { fireEvent, screen } from "@testing-library/react";

import { render } from "./i18n.test-support";
import { ActionForm } from "./index";

describe("ActionForm", () => {
	it("submits on Enter without rendering a native form", () => {
		let submissions = 0;
		render(
			<ActionForm label={testText("Search")} onSubmit={() => (submissions += 1)}>
				<input aria-label="Query" />
			</ActionForm>,
		);

		const form = screen.getByRole("form", { name: "Search" });
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Query" }), { key: "Enter" });

		expect(form.tagName).toBe("DIV");
		expect(submissions).toBe(1);
	});

	it("does not submit from multiline inputs or during IME composition", () => {
		let submissions = 0;
		render(
			<ActionForm label={testText("Notes")} onSubmit={() => (submissions += 1)}>
				<input aria-label="Title" />
				<textarea aria-label="Body" />
			</ActionForm>,
		);

		fireEvent.keyDown(screen.getByRole("textbox", { name: "Body" }), { key: "Enter" });
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Title" }), {
			key: "Enter",
			isComposing: true,
		});

		expect(submissions).toBe(0);
	});
});
