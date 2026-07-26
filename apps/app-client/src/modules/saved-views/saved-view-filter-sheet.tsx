import { Text, View } from "react-native";

import { BottomSheet } from "@/modules/ui/bottom-sheet";

import { SavedViewLayoutSelector, useSavedViewLayout } from "./saved-view-layout-selector";

export function SavedViewFilterSheet(props: { viewSlug: string; onClose: () => void }) {
	const [layout, setLayout] = useSavedViewLayout(props.viewSlug);
	return (
		<BottomSheet
			snapPoints={[260]}
			title="View options"
			onClose={props.onClose}
			description="Choose how the items in this saved view are displayed."
		>
			<View className="gap-2.5">
				<Text className="font-ui-semibold text-[11px] uppercase tracking-[0.8px] text-text-muted">
					Layout
				</Text>
				<View className="flex-row items-center justify-between">
					<Text className="font-ui-medium text-[15px] text-text">View as</Text>
					<SavedViewLayoutSelector value={layout} onChange={setLayout} />
				</View>
			</View>
		</BottomSheet>
	);
}
