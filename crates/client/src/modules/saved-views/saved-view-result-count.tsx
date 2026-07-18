import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import clsx from "clsx";
import { Pressable, Text, View } from "react-native";

import { savedViewResultCount, savedViewTotalCount } from "./result-count";
import { useSavedViewCount } from "./use-saved-view-count";

export function SavedViewResultCount(props: {
	readonly loaded: number;
	readonly hasMore: boolean;
	readonly textClassName: string;
	readonly queryDocument: RyotQLDocument;
}) {
	const { countAll, state } = useSavedViewCount(props.queryDocument);

	if (!props.hasMore) {
		return (
			<Text className={clsx(props.textClassName, "text-text-muted")}>
				{savedViewResultCount(props.loaded, false)}
			</Text>
		);
	}
	if (state.status === "resolved") {
		return (
			<Text className={clsx(props.textClassName, "text-text-muted")}>
				{savedViewTotalCount(props.loaded, state.total)}
			</Text>
		);
	}
	return (
		<View className="flex-row items-center gap-1">
			<Text className={clsx(props.textClassName, "text-text-muted")}>
				{savedViewResultCount(props.loaded, true)} ·
			</Text>
			{state.status === "counting" ? (
				<Text className={clsx(props.textClassName, "text-text-muted")}>Counting...</Text>
			) : (
				<Pressable
					hitSlop={12}
					accessibilityRole="button"
					onPress={() => void countAll()}
					accessibilityLabel="Count all results in this view"
				>
					<Text className={clsx(props.textClassName, "text-accent-text")}>
						{state.status === "failed" ? "Retry count" : "Count all"}
					</Text>
				</Pressable>
			)}
		</View>
	);
}
