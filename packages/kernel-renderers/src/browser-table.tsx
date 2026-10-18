import type { EntitySettle } from "@ryot-app/plugin-client-sdk";
import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import {
	fieldSyncState,
	isTitleProvisional,
	SettleHighlight,
	SyncPip,
} from "@ryot-app/plugin-ui-sdk/sync";
import { DataTable, type DataTableColumn, displayValueText } from "@ryot-app/plugin-ui-sdk/table";
import type {
	EntityBrowserPageInput,
	EntityBrowserResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import type { ReactNode } from "react";

import { CellThumbnail, CellValue, isAssetCell } from "./display-value";

type BrowserItem = EntityBrowserResult["items"][number];
type DeclaredBrowserColumns = NonNullable<
	(typeof EntityBrowserPageInput.Type)["settings"]["tableColumns"]
>;
export type BrowserColumns = readonly DeclaredBrowserColumns[number][];

const rowThumbnail = (item: BrowserItem) => item.cells.find(isAssetCell)?.value.value;

const VALUE_COLUMN = {
	text: {
		header: "w-2/5 px-0 py-3 text-left font-semibold",
		cell: "w-2/5 px-0 py-1 text-left text-sm text-text-muted",
	},
	compact: {
		header: "w-20 px-0 py-3 text-right font-semibold whitespace-nowrap @2xl:w-28",
		cell: "w-20 px-0 py-1 text-right text-sm whitespace-nowrap text-text-muted @2xl:w-28",
	},
} as const;

const browserColumns = (
	declared: BrowserColumns | null,
	settled: EntitySettle,
): readonly DataTableColumn<BrowserItem>[] =>
	(declared ?? [])
		.filter(({ displayKind }) => displayKind !== "managed-asset")
		.map((column, index) => ({
			id: column.field,
			header: column.label,
			cellClassName:
				index === 0
					? "min-w-0 px-0 py-1"
					: VALUE_COLUMN[column.displayKind === "text" ? "text" : "compact"].cell,
			headerClassName:
				index === 0
					? "min-w-0 px-0 py-3 text-left font-semibold"
					: VALUE_COLUMN[column.displayKind === "text" ? "text" : "compact"].header,
			cell: (item: BrowserItem) => {
				const value = item.cells.find(({ key }) => key === column.field)?.value;
				if (index !== 0) {
					if (value === undefined) {
						return null;
					}
					return column.displayKind === "text" ? (
						<span className="line-clamp-2">
							<CellValue value={value} />
						</span>
					) : (
						<CellValue value={value} />
					);
				}
				const asset = rowThumbnail(item);
				return (
					<SettleHighlight className="rounded" reason={settled.get(item.entityId)}>
						<PluginLink
							to={{ kind: "entity", entityId: item.entityId }}
							className="flex h-13 min-w-0 items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-focus"
						>
							{asset !== undefined && (
								<CellThumbnail
									asset={asset}
									monogram={item.name}
									className="h-13 w-9 shrink-0 rounded-sm"
									state={fieldSyncState(asset, item.sync)}
								/>
							)}
							<span className="truncate text-body text-text">
								{value === undefined ? "" : displayValueText(value)}
							</span>
							{isTitleProvisional(item.sync) && <SyncPip reason="translating" />}
						</PluginLink>
					</SettleHighlight>
				);
			},
		}));

export type BrowserItemActions = (item: {
	readonly entityId: string;
	readonly name: string | null;
}) => ReactNode;

const actionsColumn = (itemActions: BrowserItemActions): DataTableColumn<BrowserItem> => ({
	id: "actions",
	cell: itemActions,
	headerClassName: "w-12 px-0 py-3",
	cellClassName: "w-12 px-0 py-1 text-right",
	header: <span className="sr-only">Actions</span>,
});

export function BrowserTable({
	items,
	settled,
	columns,
	renderItemActions,
}: {
	readonly settled: EntitySettle;
	readonly columns: BrowserColumns | null;
	readonly items: readonly BrowserItem[];
	readonly renderItemActions?: BrowserItemActions | undefined;
}) {
	const declared = browserColumns(columns, settled);
	return (
		<div className="w-full max-w-6xl overflow-x-auto">
			<DataTable
				data={items}
				getRowId={(item) => item.entityId}
				rowClassName="h-15 border-b border-border"
				className="w-full border-collapse text-left"
				headerClassName="border-b border-border text-xs text-text-muted"
				columns={
					renderItemActions === undefined
						? declared
						: [...declared, actionsColumn(renderItemActions)]
				}
			/>
		</div>
	);
}
