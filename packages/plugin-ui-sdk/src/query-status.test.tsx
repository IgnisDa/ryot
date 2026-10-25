import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { QueryStatus } from "./query-status";

const renderStatus = (query: { readonly isError: boolean; readonly data: string | undefined }) => {
	const retries: string[] = [];
	render(
		<QueryStatus label="trend" query={query} onRetry={() => retries.push("retry")}>
			{(data) => <p>Data: {data}</p>}
		</QueryStatus>,
	);
	return retries;
};

it("shows first-load pending without data", () => {
	renderStatus({ isError: false, data: undefined });
	expect(screen.getByRole("status").textContent).toBe("Loading trend…");
});

it("offers retry when the first load fails", () => {
	const retries = renderStatus({ isError: true, data: undefined });
	expect(screen.getByRole("alert").textContent).toBe("Could not load trend.");
	fireEvent.click(screen.getByRole("button", { name: "Retry trend" }));
	expect(retries).toEqual(["retry"]);
	expect(screen.queryByText(/Data:/)).toBeNull();
});

it("keeps the last loaded data visible when a refresh fails", () => {
	renderStatus({ isError: true, data: "loaded" });
	expect(screen.getByText("Data: loaded")).toBeDefined();
	expect(screen.getByRole("alert").textContent).toContain("Showing the last loaded values");
});
