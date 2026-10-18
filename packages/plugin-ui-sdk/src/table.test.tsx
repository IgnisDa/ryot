import { fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { DataTable, type DataTableColumn, displayValueText } from "./table";

describe("displayValueText", () => {
	it("formats years without grouping and numbers with grouping", () => {
		expect(displayValueText({ value: 1995, displayKind: "year" })).toBe("1995");
		expect(displayValueText({ value: 1995, displayKind: "number" })).toBe(
			new Intl.NumberFormat().format(1995),
		);
		expect(displayValueText({ value: null, displayKind: "year" })).toBe("");
	});
});

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
		expect(within(table).getByRole("columnheader").classList.contains("header-cell")).toBe(true);
		expect(table.querySelector("thead")?.classList.contains("table-head")).toBe(true);
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

	it("keeps column order, distinct classes, empty cells, and interactive content", () => {
		const actions: string[] = [];
		const keys: string[] = [];
		const ref = createRef<HTMLTableElement>();
		const configured: ReadonlyArray<DataTableColumn<Person>> = [
			{
				id: "action",
				cellClassName: "action-cell",
				headerClassName: "action-header",
				header: <button onClick={() => actions.push("sort")}>Sort name</button>,
				cell: (person) => (
					<button onClick={() => actions.push(person.id)}>Open {person.name}</button>
				),
			},
			...columns,
			{
				id: "empty",
				header: "Empty",
				cellClassName: "empty-cell",
				headerClassName: "empty-header",
			},
		];
		render(
			<DataTable
				ref={ref}
				id="people"
				tabIndex={0}
				aria-label="People"
				columns={configured}
				getRowId={({ id }) => id}
				aria-describedby="people-description"
				data={[{ id: "first", name: "First" }]}
				onKeyDown={(event) => keys.push(event.key)}
			/>,
		);

		const table = screen.getByRole("table", { name: "People" });
		expect(ref.current).toBe(table);
		expect(table.id).toBe("people");
		expect(table.getAttribute("aria-describedby")).toBe("people-description");
		expect(table.tabIndex).toBe(0);
		const headers = within(table).getAllByRole("columnheader");
		expect(headers.map((header) => [header.textContent, header.className])).toEqual([
			["Sort name", "action-header"],
			["Name", "header-cell"],
			["Empty", "empty-header"],
		]);
		expect(headers.every((header) => header.getAttribute("scope") === "col")).toBe(true);
		expect(
			within(table)
				.getAllByRole("cell")
				.map((cell) => [cell.textContent, cell.className]),
		).toEqual([
			["Open First", "action-cell"],
			["First", "body-cell"],
			["", "empty-cell"],
		]);
		const action = screen.getByRole("button", { name: "Open First" });
		action.focus();
		expect(document.activeElement).toBe(action);
		fireEvent.keyDown(action, { key: "Enter" });
		fireEvent.click(action);
		fireEvent.click(screen.getByRole("button", { name: "Sort name" }));
		expect(keys).toEqual(["Enter"]);
		expect(actions).toEqual(["first", "sort"]);
	});

	it("preserves cell state when supplied rows and columns reorder and more rows arrive", () => {
		const first = { id: "first", name: "First" };
		const second = { id: "second", name: "Second" };
		const third = { id: "third", name: "Third" };
		const editable: DataTableColumn<Person> = {
			id: "note",
			header: "Note",
			cell: (person) => <input defaultValue={person.name} aria-label={`Note for ${person.name}`} />,
		};
		const { rerender } = render(
			<DataTable
				data={[first, second]}
				getRowId={({ id }) => id}
				columns={[...columns, editable]}
			/>,
		);
		const note = screen.getByRole("textbox", { name: "Note for First" });
		const cell = note.closest("td");
		const row = note.closest("tr");
		fireEvent.change(note, { target: { value: "Edited" } });

		rerender(
			<DataTable
				getRowId={({ id }) => id}
				data={[second, first, third]}
				columns={[editable, ...columns]}
			/>,
		);
		expect(screen.getByRole("textbox", { name: "Note for First" })).toBe(note);
		expect(screen.getByDisplayValue("Edited")).toBe(note);
		expect(note.closest("td")).toBe(cell);
		expect(note.closest("tr")).toBe(row);
		expect(screen.getAllByRole("row").map((item) => item.textContent)).toEqual([
			"NoteName",
			"Second",
			"First",
			"Third",
		]);
	});

	it("keeps each custom multirow group keyed without evaluating default cells", () => {
		const cells: string[] = [];
		const first = { id: "first", name: "First" };
		const second = { id: "second", name: "Second" };
		const configured: ReadonlyArray<DataTableColumn<Person>> = [
			...columns,
			{
				id: "detail",
				header: "Detail",
				cell: ({ id }) => {
					cells.push(id);
					return id;
				},
			},
		];
		const renderRow = (person: Person) => (
			<>
				<tr>
					<td colSpan={2}>{person.name}</td>
				</tr>
				<tr>
					<td colSpan={2}>
						<input defaultValue={person.name} aria-label={`Detail for ${person.name}`} />
					</td>
				</tr>
			</>
		);
		const bodyEndRows = [{ id: "status", content: <p role="status">More rows available</p> }];
		const { rerender } = render(
			<DataTable
				columns={configured}
				renderRow={renderRow}
				data={[first, second]}
				getRowId={({ id }) => id}
				bodyEndRows={bodyEndRows}
			/>,
		);
		const firstRow = screen.getByText("First").closest("tr");
		const detail = screen.getByRole("textbox", { name: "Detail for First" });
		const detailRow = detail.closest("tr");
		const statusRow = screen.getByRole("status").closest("tr");
		fireEvent.change(detail, { target: { value: "Edited detail" } });

		rerender(
			<DataTable
				columns={configured}
				renderRow={renderRow}
				data={[second, first]}
				getRowId={({ id }) => id}
				bodyEndRows={bodyEndRows}
			/>,
		);
		expect(screen.getByText("First").closest("tr")).toBe(firstRow);
		expect(screen.getByDisplayValue("Edited detail")).toBe(detail);
		expect(detail.closest("tr")).toBe(detailRow);
		expect(screen.getByRole("status").closest("tr")).toBe(statusRow);
		expect(screen.getByRole("status").closest("td")?.getAttribute("colspan")).toBe("2");
		expect(screen.getAllByRole("row").map((row) => row.textContent)).toEqual([
			"NameDetail",
			"Second",
			"",
			"First",
			"",
			"More rows available",
		]);
		expect(cells).toEqual([]);
	});
});
