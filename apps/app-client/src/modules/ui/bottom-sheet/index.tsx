import ExpoBottomSheet, {
	BottomSheetView,
	type BottomSheetProps as ExpoBottomSheetProps,
} from "@expo/ui/community/bottom-sheet";
import { useRef, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import {
	BottomSheetDialogDescription,
	BottomSheetDialogTitle,
} from "@/modules/ui/bottom-sheet/dialog-accessibility";

export function BottomSheet(props: {
	title: string;
	children: ReactNode;
	onClose: () => void;
	description: string;
	snapPoints: NonNullable<ExpoBottomSheetProps["snapPoints"]>;
}) {
	const sheetRef = useRef<ExpoBottomSheet>(null);

	return (
		<ExpoBottomSheet
			index={0}
			ref={sheetRef}
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
						<Pressable
							className="p-1"
							accessibilityRole="button"
							accessibilityLabel="Close sheet"
							onPress={() => sheetRef.current?.close()}
						>
							<AppIcon className="text-text-muted" name="x" size={17} />
						</Pressable>
					</View>
					{props.children}
				</View>
			</BottomSheetView>
		</ExpoBottomSheet>
	);
}
