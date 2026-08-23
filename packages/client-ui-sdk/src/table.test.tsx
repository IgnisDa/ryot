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
		expect(table.className).toBe("table");
		expect(within(table).getByRole("columnheader", { name: "Name" }).className).toBe("header-cell");
		expect(within(table).getByText("First").className).toBe("body-cell");
		expect(firstRow?.className).toBe("body-row");

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
		expect(status.closest("tr")?.className).toBe("status-row");
		expect(status.closest("td")?.className).toBe("status-cell");
		expect(status.closest("td")?.getAttribute("colspan")).toBe("1");
	});
});
