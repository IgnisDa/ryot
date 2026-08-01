import clsx from "clsx";
import { ScrollView, Text, View } from "react-native";

import type { SavedViewTableItem } from "./display-data";
import { formatSavedViewValue } from "./display-value";
import { SavedViewImageView } from "./saved-view-image";

const COLUMN_WIDTHS = [220, 70, 80, 90, 130];

const columnWidth = (index: number) => COLUMN_WIDTHS[index - 1] ?? 160;

export function SavedViewTable(props: {
	items: readonly SavedViewTableItem[];
	managedUrls: ReadonlyMap<string, string>;
}) {
	const headers = props.items[0]?.cells ?? [];
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator
			contentContainerClassName="w-full min-w-[1000px] pb-2"
		>
			<View className="w-full min-w-250">
				<View className="h-8.5 flex-row items-center gap-4 border-b border-border">
					{headers.map((cell, index) => (
						<View
							key={cell.key}
							style={index === 0 ? undefined : { width: columnWidth(index) }}
							className={index === 0 ? "min-w-0 flex-1" : "justify-center"}
						>
							<Text
								className={clsx(
									"font-ui-semibold text-[11.5px] uppercase tracking-[0.6px] text-text-subtle",
									index > 0 && "text-right",
								)}
								numberOfLines={1}
							>
								{cell.label}
							</Text>
						</View>
					))}
				</View>
				{props.items.map((item) => (
					<View key={item.id} className="h-12 flex-row items-center gap-4 border-b border-border">
						{item.cells.map((cell, index) => (
							<View
								key={`${item.id}:${cell.key}`}
								style={index === 0 ? undefined : { width: columnWidth(index) }}
								className={
									index === 0 ? "min-w-0 flex-1 flex-row items-center gap-2.5" : "justify-center"
								}
							>
								{index === 0 && (
									<SavedViewImageView
										image={item.image}
										managedUrls={props.managedUrls}
										className="h-9 w-6.5 shrink-0 rounded-[3px] bg-surface-2"
									/>
								)}
								<Text
									numberOfLines={1}
									className={
										index === 0
											? "min-w-0 flex-1 font-ui text-sm text-text"
											: "font-ui text-right text-[13.5px] text-text-muted"
									}
								>
									{formatSavedViewValue(cell.value)}
								</Text>
							</View>
						))}
					</View>
				))}
			</View>
		</ScrollView>
	);
}
