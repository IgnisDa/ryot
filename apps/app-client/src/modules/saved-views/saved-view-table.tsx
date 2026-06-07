import { ScrollView, Text, View } from "react-native";

import type { SavedViewDisplayItem } from "./display-data";
import { formatSavedViewValue } from "./display-value";
import { SavedViewImageView } from "./saved-view-image";

const FIRST_COLUMN_WIDTH = 240;
const COLUMN_WIDTH = 160;

export function SavedViewTable(props: { items: readonly SavedViewDisplayItem[] }) {
	const headers = props.items[0]?.table.cells ?? [];
	const tableWidth = Math.max(640, FIRST_COLUMN_WIDTH + (headers.length - 1) * COLUMN_WIDTH);
	return (
		<ScrollView horizontal showsHorizontalScrollIndicator contentContainerClassName="pb-2">
			<View style={{ width: tableWidth }} className="border-t border-border">
				<View className="h-8.5 flex-row border-b border-border bg-surface-2">
					{headers.map((cell, index) => (
						<View
							key={`${cell.label}:${index}`}
							style={{ width: index === 0 ? FIRST_COLUMN_WIDTH : COLUMN_WIDTH }}
							className="justify-center border-r border-border px-3 last:border-r-0"
						>
							<Text className="font-ui-semibold text-xs text-text-muted" numberOfLines={1}>
								{cell.label}
							</Text>
						</View>
					))}
				</View>
				{props.items.map((item) => (
					<View key={item.id} className="h-14 flex-row border-b border-border md:h-12">
						{item.table.cells.map((cell, index) => (
							<View
								key={`${item.id}:${index}`}
								style={{ width: index === 0 ? FIRST_COLUMN_WIDTH : COLUMN_WIDTH }}
								className="flex-row items-center gap-2.5 border-r border-border px-3 last:border-r-0"
							>
								{index === 0 && (
									<SavedViewImageView
										image={item.table.image}
										className="h-8 w-[22px] shrink-0 rounded-sm bg-surface-2 md:h-9 md:w-6.5"
									/>
								)}
								<Text className="min-w-0 flex-1 font-ui text-sm text-text" numberOfLines={1}>
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
