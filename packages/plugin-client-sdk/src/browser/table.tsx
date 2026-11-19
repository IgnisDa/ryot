import type { DisplayText } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { type ItemSelection, SelectableItem } from "@ryot-app/plugin-ui-sdk";
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

import { useDisplayText } from "../i18n/messages";
import { NavigationEnabledContext, PluginLink } from "../navigation/routing";
import type { EntitySettle } from "../refresh/settle";
import { CellThumbnail, CellValue, isAssetCell } from "./display-value";

export type BrowserColumns = readonly DeclaredBrowserColumns[number][];
type BrowserItem = EntityBrowserResult["items"][number];
type DeclaredBrowserColumns = NonNullable<
	(typeof EntityBrowserPageInput.Type)["settings"]["tableColumns"]
>;

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
	displayText: (text: DisplayText) => Text,
	declared: null | BrowserColumns,
	settled: EntitySettle,
	selection: undefined | ItemSelection,
): readonly DataTableColumn<BrowserItem>[] =>
	(declared ?? [])
		.filter(({ displayKind }) => displayKind !== "managed-asset")
		.map((column, index) => ({
			id: column.field,
			header: <HeaderText text={column.label} />,
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
						<SelectableItem id={item.entityId} selection={selection} label={displayText(item.name)}>
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
									{value === undefined ? "" : <CellText value={value} />}
								</span>
								{isTitleProvisional(item.sync) && <SyncPip reason="translating" />}
							</PluginLink>
						</SelectableItem>
					</SettleHighlight>
				);
			},
		}));

export type BrowserItemActions = (item: {
	readonly entityId: string;
	readonly name: null | string;
}) => ReactNode;

function HeaderText(props: { readonly text: DisplayText }) {
	return useDisplayText()(props.text);
}

function CellText(props: { readonly value: Parameters<typeof displayValueText>[2] }) {
	return displayValueText(useT(), useFormatters(), props.value);
}

const actionsColumn = (
	header: string,
	itemActions: BrowserItemActions,
): DataTableColumn<BrowserItem> => ({
	id: "actions",
	cell: itemActions,
	headerClassName: "w-12 px-0 py-3",
	cellClassName: "w-12 px-0 py-1 text-right",
	header: <span className="sr-only">{header}</span>,
});

export function BrowserTable({
	items,
	settled,
	columns,
	selection,
	renderItemActions,
	navigationEnabled = true,
}: {
	readonly settled: EntitySettle;
	readonly navigationEnabled?: boolean;
	readonly items: readonly BrowserItem[];
	readonly columns: null | BrowserColumns;
	readonly selection: undefined | ItemSelection;
	readonly renderItemActions?: undefined | BrowserItemActions;
}) {
	const t = useT();
	const displayText = useDisplayText();
	const declared = browserColumns(displayText, columns, settled, selection);
	return (
		<NavigationEnabledContext.Provider value={navigationEnabled}>
			<div className="w-full max-w-6xl overflow-x-auto">
				<DataTable
					data={items}
					getRowId={(item) => item.entityId}
					rowClassName="h-15 border-b border-border"
					className="w-full border-collapse text-left"
					headerClassName="border-b border-border text-xs text-text-muted"
					columns={
						renderItemActions === undefined || selection !== undefined
							? declared
							: [
									...declared,
									actionsColumn(t(kernelMessage("sdk.browser.actions")), renderItemActions),
								]
					}
				/>
			</div>
		</NavigationEnabledContext.Provider>
	);
}
