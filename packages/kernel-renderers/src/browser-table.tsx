import type { EntitySettle } from "@ryot-app/client-sdk";
import { PluginLink } from "@ryot-app/client-sdk/plugin";
import {
	fieldSyncState,
	isTitleProvisional,
	SettleHighlight,
	SyncPip,
} from "@ryot-app/client-ui-sdk/sync";
import { DataTable, type DataTableColumn } from "@ryot-app/client-ui-sdk/table";
import type {
	EntityBrowserPageInput,
	EntityBrowserResult,
} from "@ryot-app/ryotql-recipes/saved-views";

import { CellThumbnail, CellValue, cellText, isAssetCell } from "./display-value";

type BrowserItem = EntityBrowserResult["items"][number];
type DeclaredBrowserColumns = NonNullable<
	(typeof EntityBrowserPageInput.Type)["settings"]["tableColumns"]
>;
export type BrowserColumns = readonly DeclaredBrowserColumns[number][];

const rowThumbnail = (item: BrowserItem) => item.cells.find(isAssetCell)?.value.value;

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
					: "w-16 px-0 py-1 text-right text-sm text-text-muted @2xl:w-28",
			headerClassName:
				index === 0
					? "min-w-0 px-0 py-3 text-left font-semibold"
					: "w-16 px-0 py-3 text-right font-semibold @2xl:w-28",
			cell: (item: BrowserItem) => {
				const value = item.cells.find(({ key }) => key === column.field)?.value;
				if (index !== 0) {
					return value === undefined ? null : <CellValue value={value} />;
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
							<span className="truncate text-[15px] text-text">
								{value === undefined ? "" : cellText(value)}
							</span>
							{isTitleProvisional(item.sync) && <SyncPip reason="translating" />}
						</PluginLink>
					</SettleHighlight>
				);
			},
		}));

export function BrowserTable({
	items,
	settled,
	columns,
}: {
	readonly settled: EntitySettle;
	readonly columns: BrowserColumns | null;
	readonly items: readonly BrowserItem[];
}) {
	return (
		<div className="w-full max-w-6xl overflow-x-auto">
			<DataTable
				data={items}
				getRowId={(item) => item.entityId}
				rowClassName="h-15 border-b border-border"
				columns={browserColumns(columns, settled)}
				className="w-full border-collapse text-left"
				headerClassName="border-b border-border text-xs text-text-muted"
			/>
		</div>
	);
}
