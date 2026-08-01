import type { ReactTable, RowData, TableFeatures, TableState } from "@tanstack/react-table";
import clsx from "clsx";
import { Text, View } from "react-native";

declare module "@tanstack/react-table" {
	interface ColumnMeta<
		in out TFeatures extends TableFeatures,
		in out TData extends RowData,
		TValue,
	> {
		readonly className: string;
		readonly headerClassName?: string;
	}
}

export interface AppTableColumnMeta {
	readonly className: string;
	readonly headerClassName?: string;
}

export function AppTableHeader<
	TFeatures extends TableFeatures & { columnMeta: AppTableColumnMeta },
	TData extends RowData,
	TSelected = TableState<TFeatures>,
>(props: { readonly table: ReactTable<TFeatures, TData, TSelected> }) {
	return props.table.getHeaderGroups().map((group) => (
		<View
			key={group.id}
			className="h-8.5 flex-row items-center gap-3 border-b border-border md:gap-4"
		>
			{group.headers.map((header) => (
				<View
					key={header.id}
					className={clsx(header.column.columnDef.meta?.className, "justify-center")}
				>
					{header.isPlaceholder ? null : (
						<Text
							numberOfLines={1}
							className={clsx(
								"font-ui-semibold text-[11.5px] uppercase tracking-[0.6px] text-text-subtle",
								header.column.columnDef.meta?.headerClassName,
							)}
						>
							<props.table.FlexRender header={header} />
						</Text>
					)}
				</View>
			))}
		</View>
	));
}
