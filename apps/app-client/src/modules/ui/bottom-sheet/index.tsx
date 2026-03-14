import ExpoBottomSheet, {
	BottomSheetView,
	type BottomSheetProps as ExpoBottomSheetProps,
} from "@expo/ui/community/bottom-sheet";
import clsx from "clsx";
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
	titleClassName?: string;
	headerAction?: ReactNode;
	contentClassName?: string;
	snapPoints: NonNullable<ExpoBottomSheetProps["snapPoints"]>;
}) {
	return (
		<ExpoBottomSheet
			index={0}
			enablePanDownToClose
			handleComponent={null}
			onClose={props.onClose}
			snapPoints={props.snapPoints}
			backgroundStyle={{ padding: 0, backgroundColor: "transparent" }}
		>
			<BottomSheetView style={{ flex: 1 }}>
				<View
					className={clsx(
						"flex-1 rounded-t-2xl border-t border-border bg-surface px-4 pb-4 pt-2",
						props.contentClassName,
					)}
				>
					<BottomSheetDialogDescription>
						<Text className="sr-only">{props.description}</Text>
					</BottomSheetDialogDescription>
					<View className="flex-row items-center justify-between py-4">
						<BottomSheetDialogTitle>
							<Text
								accessibilityRole="header"
								className={clsx("font-display-semibold text-xl text-text", props.titleClassName)}
							>
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
