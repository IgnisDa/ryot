import { Pressable, ScrollView, Text, View } from "react-native";

import { AppIcon as NavigationIcon } from "@/modules/icons";
import { BottomSheet } from "@/modules/ui/bottom-sheet";

import type { NavigationItem, NavigationItems } from "./navigation-data";
import { DIRECT_WORKSPACE_TAB_COUNT } from "./workspace-tabs";

export function MobileMoreSheet(props: {
	onClose: () => void;
	items: NavigationItems;
	onNavigate: (item: NavigationItem) => void;
}) {
	return (
		<BottomSheet
			title="More views"
			snapPoints={[570]}
			onClose={props.onClose}
			titleClassName="font-ui-semibold text-lg"
			contentClassName="rounded-t-[22px] pt-2.5"
			description="Open and reorder additional views."
			headerAction={
				<View className="h-7.5 flex-row items-center gap-1.5 rounded-pill bg-surface-2 px-3">
					<NavigationIcon className="text-accent-text" name="arrow-up-down" size={14} />
					<Text className="font-ui-semibold text-[13px] text-accent-text">Reorder</Text>
				</View>
			}
		>
			<ScrollView
				className="flex-1"
				showsVerticalScrollIndicator={false}
				contentContainerClassName="gap-1.5 pb-4"
			>
				{props.items.views.slice(DIRECT_WORKSPACE_TAB_COUNT).map((item) => (
					<Pressable
						key={item.slug}
						accessibilityRole="button"
						accessibilityLabel={item.name}
						onPress={() => props.onNavigate(item)}
						className="h-13 flex-row items-center gap-3 rounded-[10px] bg-surface-2 px-3"
					>
						<View className="h-8 w-8 items-center justify-center rounded-[9px] bg-accent-soft">
							<NavigationIcon className="text-accent-text" name={item.icon} size={17} />
						</View>
						<Text className="flex-1 font-ui-semibold text-[15px] text-text">{item.name}</Text>
						<NavigationIcon className="text-text-subtle" name="grip-vertical" size={17} />
					</Pressable>
				))}
			</ScrollView>
		</BottomSheet>
	);
}
