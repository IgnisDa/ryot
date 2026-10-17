import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoadMoreButton } from "./load-more-button";

describe("LoadMoreButton", () => {
	it("keeps the idle label and independent disabled state", () => {
		render(<LoadMoreButton disabled label="Load more" isFetchingNextPage={false} />);

		const button = screen.getByRole("button", { name: "Load more" });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(button.hasAttribute("aria-busy")).toBe(false);
		expect(button.getAttribute("type")).toBe("button");
		expect(button.classList.contains("bg-surface-2")).toBe(true);
	});

	it("shows the loading label and reports busy while fetching", () => {
		render(
			<LoadMoreButton
				label="Load more"
				isFetchingNextPage={true}
				loadingLabel="Fetching next page..."
			/>,
		);

		const button = screen.getByRole("button", { name: "Fetching next page..." });
		expect(button.getAttribute("aria-busy")).toBe("true");
		expect(button.hasAttribute("disabled")).toBe(true);
	});

	it("forwards button props and calls the idle click handler once", () => {
		const clicks: string[] = [];
		const recordClick = () => {
			clicks.push("load");
		};
		render(
			<LoadMoreButton
				type="submit"
				label="Load more"
				variant="primary"
				className="w-full"
				onClick={recordClick}
				isFetchingNextPage={false}
			/>,
		);

		const button = screen.getByRole("button", { name: "Load more" });
		fireEvent.click(button);

		expect(clicks).toEqual(["load"]);
		expect(button.classList.contains("w-full")).toBe(true);
		expect(button.classList.contains("bg-accent")).toBe(true);
		expect(button.getAttribute("type")).toBe("submit");
	});
});
