import ExpoBottomSheet, {
	BottomSheetView,
	type BottomSheetProps as ExpoBottomSheetProps,
} from "@expo/ui/community/bottom-sheet";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import {
	BottomSheetDialogDescription,
	BottomSheetDialogTitle,
} from "@/modules/ui/bottom-sheet/dialog-accessibility";

export function BottomSheet(props: {
	title: string;
	children: ReactNode;
	onClose: () => void;
	description: string;
	headerAction?: ReactNode;
	snapPoints: NonNullable<ExpoBottomSheetProps["snapPoints"]>;
}) {
	return (
		<ExpoBottomSheet
			index={0}
			enablePanDownToClose
			onClose={props.onClose}
			snapPoints={props.snapPoints}
			backgroundStyle={{ padding: 0, backgroundColor: "transparent" }}
		>
			<BottomSheetView style={{ flex: 1 }}>
				<View className="flex-1 rounded-t-2xl border-t border-border bg-surface px-4 pb-4 pt-2">
					<BottomSheetDialogDescription>
						<Text className="sr-only">{props.description}</Text>
					</BottomSheetDialogDescription>
					<View className="flex-row items-center justify-between py-4">
						<BottomSheetDialogTitle>
							<Text accessibilityRole="header" className="font-display-semibold text-xl text-text">
								{props.title}
							</Text>
						</BottomSheetDialogTitle>
						{props.headerAction}
					</View>
					{props.children}
				</View>
			</BottomSheetView>
		</ExpoBottomSheet>
	);
}
