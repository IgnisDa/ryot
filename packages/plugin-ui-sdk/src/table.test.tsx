import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataTable, type DataTableColumn } from "./table";

type Person = { readonly id: string; readonly name: string };

const columns: ReadonlyArray<DataTableColumn<Person>> = [
	{
		id: "name",
		header: "Name",
		cell: ({ name }) => name,
		cellClassName: "body-cell",
		headerClassName: "header-cell",
	},
];

describe("DataTable", () => {
	it("renders semantic configured columns with static classes and stable row ids", () => {
		const first = { id: "first", name: "First" };
		const second = { id: "second", name: "Second" };
		const { rerender } = render(
			<DataTable
				columns={columns}
				className="table"
				data={[first, second]}
				rowClassName="body-row"
				getRowId={({ id }) => id}
				headerClassName="table-head"
			/>,
		);

		const table = screen.getByRole("table");
		const firstRow = within(table).getByText("First").closest("tr");
		expect(table.classList.contains("table")).toBe(true);
		expect(within(table).getByRole("columnheader", { name: "Name" }).getAttribute("scope")).toBe(
			"col",
		);
		expect(within(table).getAllByRole("row")).toHaveLength(3);
		expect(within(table).getByText("First").classList.contains("body-cell")).toBe(true);
		expect(firstRow?.classList.contains("body-row")).toBe(true);

		rerender(
			<DataTable
				columns={columns}
				className="table"
				data={[second, first]}
				rowClassName="body-row"
				getRowId={({ id }) => id}
				headerClassName="table-head"
			/>,
		);
		expect(within(table).getByText("First").closest("tr")).toBe(firstRow);
	});

	it("supports custom row rendering and structured body-end status rows", () => {
		render(
			<DataTable
				columns={columns}
				getRowId={({ id }) => id}
				data={[{ id: "first", name: "First" }]}
				renderRow={(person) => (
					<tr data-row-id={person.id}>
						<td>{person.name} custom</td>
					</tr>
				)}
				bodyEndRows={[
					{
						id: "loading",
						rowClassName: "status-row",
						cellClassName: "status-cell",
						content: <p role="status">Loading more...</p>,
					},
				]}
			/>,
		);

		expect(screen.getByText("First custom").closest("tr")?.dataset.rowId).toBe("first");
		const status = screen.getByRole("status");
		expect(status.textContent).toBe("Loading more...");
		expect(status.closest("tr")?.classList.contains("status-row")).toBe(true);
		expect(status.closest("td")?.classList.contains("status-cell")).toBe(true);
		expect(status.closest("td")?.getAttribute("colspan")).toBe("1");
	});
});
