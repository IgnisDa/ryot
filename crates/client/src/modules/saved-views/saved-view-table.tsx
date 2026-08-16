import type { SavedViewTableMapping } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	createColumnHelper,
	metaHelper,
	tableFeatures,
	type ReactTable,
	type Row,
	useTable,
} from "@tanstack/react-table";
import clsx from "clsx";
import { Link } from "expo-router";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { getEntityHref } from "@/modules/navigation/navigation-data";
import { ImageTintOverlay, useImageTint } from "@/modules/ui/image-tint-view";
import { useManagedAssetUrl } from "@/modules/ui/managed-asset-context";
import { AppTableHeader, type AppTableColumnMeta } from "@/modules/ui/table";

import type { SavedViewTableItem } from "./display-data";
import { formatSavedViewValue } from "./display-value";
import { SavedViewImageView } from "./saved-view-image";

const savedViewTableFeatures = tableFeatures({
	columnMeta: metaHelper<AppTableColumnMeta>(),
});
const columnHelper = createColumnHelper<typeof savedViewTableFeatures, SavedViewTableItem>();

function SavedViewTableRow(props: {
	readonly row: Row<typeof savedViewTableFeatures, SavedViewTableItem>;
	readonly table: ReactTable<typeof savedViewTableFeatures, SavedViewTableItem>;
}) {
	const image = props.row.original.image;
	const url = useManagedAssetUrl(image.type === "asset" ? image.locator : undefined);
	const { gradientStops, onImageError } = useImageTint(url);

	return (
		<Link asChild href={getEntityHref(props.row.original.entityId)}>
			<Pressable
				accessibilityRole="link"
				className="relative h-15 flex-row items-center gap-3 overflow-hidden border-b border-border focus-visible:outline-2 focus-visible:outline-accent md:gap-4"
			>
				<ImageTintOverlay direction="horizontal" gradientStops={gradientStops} />
				{props.row.getAllCells().map((cell, index) => (
					<View
						key={cell.id}
						className={clsx(
							cell.column.columnDef.meta?.className,
							"justify-center",
							index === 0 && "flex-row items-center gap-3",
						)}
					>
						{index === 0 ? (
							<Link.AppleZoom>
								<SavedViewImageView
									image={image}
									collapsable={false}
									onError={onImageError}
									className="h-13 w-9 shrink-0 rounded-sm bg-surface-2"
								/>
							</Link.AppleZoom>
						) : null}
						<Text
							numberOfLines={1}
							className={clsx(
								"min-w-0 font-ui",
								index === 0 && "flex-1 text-[15px] text-text",
								index > 0 && "text-right text-sm text-text-muted",
							)}
						>
							<props.table.FlexRender cell={cell} />
						</Text>
					</View>
				))}
			</Pressable>
		</Link>
	);
}

export function SavedViewTable(props: {
	readonly items: readonly SavedViewTableItem[];
	readonly columns: SavedViewTableMapping["columns"];
}) {
	const columns = useMemo(
		() =>
			columnHelper.columns(
				props.columns.map((column, index) =>
					columnHelper.accessor(
						(item) => item.cells.find((cell) => cell.key === column.field)?.value,
						{
							id: column.field,
							header: column.label,
							cell: (context) => {
								const value = context.getValue();
								return value === undefined ? null : formatSavedViewValue(value);
							},
							meta: {
								className: clsx(
									index === 0 && "min-w-0 flex-1",
									index > 0 && "w-16 shrink-0 md:w-28",
								),
								headerClassName: clsx(index > 0 && "text-right"),
							},
						},
					),
				),
			),
		[props.columns],
	);
	const table = useTable({
		columns,
		data: props.items,
		features: savedViewTableFeatures,
		getRowId: (item) => item.entityId,
	});
	return (
		<View className="w-full max-w-6xl">
			<AppTableHeader table={table} />
			{table.getRowModel().rows.map((row) => (
				<SavedViewTableRow key={row.id} row={row} table={table} />
			))}
		</View>
	);
}
