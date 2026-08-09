import { type ColumnDef, tableFeatures, useTable } from "@tanstack/react-table";
import { Fragment, type ComponentProps, type ReactNode } from "react";

const features = tableFeatures({});
const emptyBodyEndRows: ReadonlyArray<DataTableBodyEndRow> = [];

export type DataTableColumn<T> = {
	readonly id: string;
	readonly header: ReactNode;
	readonly cellClassName?: string;
	readonly headerClassName?: string;
	readonly cell?: (item: T) => ReactNode;
};

export type DataTableBodyEndRow = {
	readonly id: string;
	readonly content: ReactNode;
	readonly rowClassName?: string;
	readonly cellClassName?: string;
};

export type DataTableProps<T> = Omit<ComponentProps<"table">, "children"> & {
	readonly rowClassName?: string;
	readonly data: ReadonlyArray<T>;
	readonly headerClassName?: string;
	readonly getRowId: (item: T) => string;
	readonly renderRow?: (item: T) => ReactNode;
	readonly columns: ReadonlyArray<DataTableColumn<T>>;
	readonly bodyEndRows?: ReadonlyArray<DataTableBodyEndRow>;
};

type InternalRow<T> = { readonly item: T };

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
	const tableColumns: Array<ColumnDef<typeof features, InternalRow<T>>> = columns.map((column) => ({
		id: column.id,
		header: () => column.header,
		cell: ({ row }) => column.cell?.(row.original.item),
	}));
	const table = useTable<typeof features, InternalRow<T>>({
		features,
		columns: tableColumns,
		getRowId: ({ item }) => getRowId(item),
		data: data.map((item) => ({ item })),
	});

	return (
		<table className={className} {...tableProps}>
			<thead className={headerClassName}>
				{table.getHeaderGroups().map((headerGroup) => (
					<tr key={headerGroup.id}>
						{headerGroup.headers.map((header) => {
							const column = columns.find(({ id }) => id === header.column.id);
							return (
								<th
									scope="col"
									key={header.id}
									colSpan={header.colSpan}
									className={column?.headerClassName}
								>
									{header.isPlaceholder ? null : <table.FlexRender header={header} />}
								</th>
							);
						})}
					</tr>
				))}
			</thead>
			<tbody>
				{table.getRowModel().rows.map((row) =>
					renderRow ? (
						<Fragment key={row.id}>{renderRow(row.original.item)}</Fragment>
					) : (
						<tr key={row.id} className={rowClassName}>
							{row.getAllCells().map((cell) => (
								<td
									key={cell.id}
									className={columns.find(({ id }) => id === cell.column.id)?.cellClassName}
								>
									<table.FlexRender cell={cell} />
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
