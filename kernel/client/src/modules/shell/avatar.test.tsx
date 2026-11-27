import { describe, expect, it } from "bun:test";

import { fireEvent, render, screen } from "@testing-library/react";

import { testI18nWrapper } from "#/modules/i18n/provider.test-support";
import { Avatar } from "#/modules/shell/avatar";

describe("avatar", () => {
	it("renders the session image with an accessible name", () => {
		render(<Avatar name="Ada Lovelace" image="https://example.test/ada.png" />, {
			wrapper: testI18nWrapper(),
		});

		expect(screen.getByRole("img", { name: "Ada Lovelace's avatar" }).getAttribute("src")).toBe(
			"https://example.test/ada.png",
		);
	});

	it("uses the user icon after the local image fails", () => {
		const { container } = render(
			<Avatar name="Ada Lovelace" image="https://example.test/bad.png" />,
			{ wrapper: testI18nWrapper() },
		);

		fireEvent.error(screen.getByRole("img"));

		expect(screen.queryByRole("img")).toBeNull();
		expect(container.querySelector('[data-app-icon="user"]')).not.toBeNull();
	});

	it("uses the user icon for a null image", () => {
		const { container } = render(<Avatar image={null} name="Ada Lovelace" />, {
			wrapper: testI18nWrapper(),
		});

		expect(screen.queryByRole("img")).toBeNull();
		expect(container.querySelector('[data-app-icon="user"]')).not.toBeNull();
	});

	it("renders a different image URL after an earlier URL fails", () => {
		const { rerender } = render(
			<Avatar name="Ada Lovelace" image="https://example.test/first.png" />,
			{ wrapper: testI18nWrapper() },
		);
		fireEvent.error(screen.getByRole("img"));

		rerender(<Avatar name="Ada Lovelace" image="https://example.test/second.png" />);

		expect(screen.getByRole("img").getAttribute("src")).toBe("https://example.test/second.png");
	});
});
