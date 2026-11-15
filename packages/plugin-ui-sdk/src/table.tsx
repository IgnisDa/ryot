import type { SavedViewDisplayValue } from "@ryot-app/contract/modules/saved-views/schemas";
import { type ComponentProps, Fragment, type ReactNode } from "react";

import { reportText, useReportBlock } from "./report";

export const displayValueText = (value: SavedViewDisplayValue): string => {
	if (
		value.value === null ||
		value.displayKind === "managed-asset" ||
		value.displayKind === "rating"
	) {
		return "";
	}
	switch (value.displayKind) {
		case "date":
			return new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(new Date(value.value));
		case "year":
			return String(value.value);
		case "json":
			return JSON.stringify(value.value);
		case "text":
			return value.value;
		case "number":
			return new Intl.NumberFormat().format(value.value);
		case "boolean":
			return value.value ? "Yes" : "No";
	}
	return "";
};

const emptyBodyEndRows: ReadonlyArray<DataTableBodyEndRow> = [];

export type DataTableColumn<T> = {
	readonly id: string;
	readonly report?: false;
	readonly header: ReactNode;
	readonly rowHeader?: boolean;
	readonly cellClassName?: string;
	readonly headerClassName?: string;
	readonly cell?: (item: T) => ReactNode;
};

type DataTableBodyEndRow = {
	readonly id: string;
	readonly content: ReactNode;
	readonly rowClassName?: string;
	readonly cellClassName?: string;
};

type DataTableProps<T> = Omit<ComponentProps<"table">, "children"> & {
	readonly rowClassName?: string;
	readonly cellClassName?: string;
	readonly data: ReadonlyArray<T>;
	readonly headerClassName?: string;
	readonly headerCellClassName?: string;
	readonly getRowId: (item: T) => string;
	readonly renderRow?: (item: T) => ReactNode;
	readonly columns: ReadonlyArray<DataTableColumn<T>>;
	readonly bodyEndRows?: ReadonlyArray<DataTableBodyEndRow>;
};

export function DataTable<T>({
	data,
	columns,
	getRowId,
	renderRow,
	className,
	rowClassName,
	cellClassName,
	headerClassName,
	headerCellClassName,
	bodyEndRows = emptyBodyEndRows,
	...tableProps
}: DataTableProps<T>) {
	const report = useReportBlock(() => {
		const selected = columns.filter((column) => column.report !== false);
		if (renderRow) {
			throw new Error("Report tables require column-owned cells");
		}
		return {
			kind: "table",
			title: tableProps["aria-label"],
			headers: selected.map((column) => reportText(column.header)),
			rows: [
				...data.map((item) => selected.map((column) => reportText(column.cell?.(item)))),
				...bodyEndRows.map((row) => [reportText(row.content)]),
			],
		};
	});
	return (
		<div ref={report} className="contents">
			<table className={className} {...tableProps}>
				<thead className={headerClassName}>
					<tr>
						{columns.map((column) => (
							<th
								scope="col"
								key={column.id}
								className={column.headerClassName ?? headerCellClassName}
							>
								{column.header}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{data.map((item) =>
						renderRow ? (
							<Fragment key={getRowId(item)}>{renderRow(item)}</Fragment>
						) : (
							<tr key={getRowId(item)} className={rowClassName}>
								{columns.map((column) => {
									const Cell = column.rowHeader === true ? "th" : "td";
									return (
										<Cell
											key={column.id}
											className={column.cellClassName ?? cellClassName}
											scope={column.rowHeader === true ? "row" : undefined}
										>
											{column.cell?.(item)}
										</Cell>
									);
								})}
							</tr>
						),
					)}
					{bodyEndRows.map((row) => (
						<tr key={row.id} className={row.rowClassName}>
							<td colSpan={columns.length} className={row.cellClassName}>
								{row.content}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
