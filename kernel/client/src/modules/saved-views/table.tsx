import { DataTable, type DataTableColumn } from "@ryot-app/client-ui-sdk/table";
import type { SavedViewTableMapping } from "@ryot-app/contract/modules/saved-views/schemas";
import type { SavedViewTableResultItem } from "@ryot-app/ryotql-recipes/saved-views";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { ManagedImage } from "#/modules/assets/managed-image";
import { formatSavedViewValue } from "#/modules/saved-views/display-value";

const savedViewColumns = (
	columns: SavedViewTableMapping["columns"],
	managedUrls: ReadonlyMap<string, string>,
): readonly DataTableColumn<SavedViewTableResultItem>[] =>
	columns.map((column, index) => ({
		header: column.label,
		id: `${column.field}:${index}`,
		headerClassName:
			index === 0
				? "min-w-0 px-0 py-3 text-left font-semibold"
				: "w-16 px-0 py-3 text-right font-semibold md:w-28",
		cellClassName:
			index === 0
				? "min-w-0 px-0 py-1"
				: "w-16 px-0 py-1 text-right text-sm text-text-muted md:w-28",
		cell: (item) => {
			const value = item.cells.find((cell) => cell.key === column.field)?.value;
			const content = value === undefined ? null : formatSavedViewValue(value);
			if (index !== 0) {
				return content;
			}
			return (
				<Link
					to="/e/$entityId"
					params={{ entityId: item.entityId }}
					className="flex h-13 min-w-0 items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-focus"
				>
					{item.image !== undefined && (
						<ManagedImage
							asset={item.image}
							urls={managedUrls}
							className="h-13 w-9 shrink-0 rounded-sm bg-surface-2 object-cover"
						/>
					)}
					<span className="truncate text-[15px] text-text">{content}</span>
				</Link>
			);
		},
	}));

export function SavedViewTable(props: {
	readonly managedUrls: ReadonlyMap<string, string>;
	readonly columns: SavedViewTableMapping["columns"];
	readonly items: readonly SavedViewTableResultItem[];
}) {
	const columns: readonly DataTableColumn<SavedViewTableResultItem>[] = useMemo(
		() => savedViewColumns(props.columns, props.managedUrls),
		[props.columns, props.managedUrls],
	);
	return (
		<div className="w-full max-w-6xl overflow-x-auto">
			<DataTable
				columns={[...columns]}
				data={[...props.items]}
				getRowId={(item) => item.entityId}
				rowClassName="h-15 border-b border-border"
				className="w-full border-collapse text-left"
				headerClassName="border-b border-border text-xs text-text-muted"
			/>
		</div>
	);
}
