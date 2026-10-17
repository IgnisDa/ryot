import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProviderSearchResultRow } from "#/modules/provider-add/result-row";

const item = { externalId: "fixture", title: "Fixture item" };

describe("provider search result row", () => {
	it("shows the queued and importing states and clears pending styling when idle", () => {
		let addCount = 0;
		const onAdd = () => {
			addCount += 1;
		};
		const view = render(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				entry={{ status: "idle" }}
				linkedEntityId={undefined}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add Fixture item" }));
		expect(addCount).toBe(1);

		view.rerender(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				linkedEntityId={undefined}
				entry={{ status: "queued" }}
			/>,
		);
		expect(screen.getByRole("status", { name: "Queued Fixture item" }).textContent).toContain(
			"Queued",
		);
		expect(screen.queryByRole("button", { name: "Add Fixture item" })).toBeNull();

		view.rerender(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				linkedEntityId={undefined}
				entry={{ status: "importing" }}
			/>,
		);
		const status = screen.getByRole("status", { name: "Adding Fixture item" });
		expect(status.textContent).toContain("Adding…");
		const spinner = status.querySelector('[aria-hidden="true"]');
		expect(spinner?.classList.contains("motion-reduce:animate-none")).toBe(true);
		expect(view.container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
		expect(view.container.firstElementChild?.classList.contains("bg-accent-soft")).toBe(true);

		view.rerender(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				entry={{ status: "idle" }}
				linkedEntityId={undefined}
			/>,
		);
		expect(view.container.firstElementChild?.getAttribute("aria-busy")).toBeNull();
		expect(view.container.firstElementChild?.classList.contains("bg-accent-soft")).toBe(false);
	});

	it("shows a failed import message and retries the add", () => {
		let addCount = 0;
		const onAdd = () => {
			addCount += 1;
		};
		const view = render(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				linkedEntityId={undefined}
				entry={{ status: "importing" }}
			/>,
		);

		view.rerender(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				linkedEntityId={undefined}
				entry={{ status: "failed", message: "Could not add this item." }}
			/>,
		);
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.getByText("Could not add this item.")).toBeTruthy();
		expect(view.container.firstElementChild?.getAttribute("aria-busy")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Retry adding Fixture item" }));
		expect(addCount).toBe(1);
	});
});
