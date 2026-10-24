import { type ComponentProps, Fragment, type ReactNode } from "react";

const emptyBodyEndRows: ReadonlyArray<DataTableBodyEndRow> = [];

export type DataTableColumn<T> = {
	readonly id: string;
	readonly header: ReactNode;
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
	readonly data: ReadonlyArray<T>;
	readonly headerClassName?: string;
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
	headerClassName,
	bodyEndRows = emptyBodyEndRows,
	...tableProps
}: DataTableProps<T>) {
	return (
		<table className={className} {...tableProps}>
			<thead className={headerClassName}>
				<tr>
					{columns.map((column) => (
						<th scope="col" key={column.id} className={column.headerClassName}>
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
							{columns.map((column) => (
								<td key={column.id} className={column.cellClassName}>
									{column.cell?.(item)}
								</td>
							))}
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
	);
}
