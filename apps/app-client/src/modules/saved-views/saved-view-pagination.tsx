import clsx from "clsx";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";

export function SavedViewPagination(props: {
	readonly name: string;
	readonly loaded: number;
	readonly hasMore: boolean;
	readonly isLoading: boolean;
	readonly onLoadMore: () => void;
}) {
	return (
		<View className="w-full items-center gap-2.5 py-2 md:py-7">
			{props.hasMore ? (
				<Pressable
					disabled={props.isLoading}
					onPress={props.onLoadMore}
					accessibilityRole="button"
					accessibilityState={{ disabled: props.isLoading }}
					accessibilityLabel={props.isLoading ? "Loading more results" : "Load more results"}
					className={clsx(
						"h-12 w-full flex-row items-center justify-center gap-2 rounded-md bg-surface-2 px-4 md:h-8.5 md:w-auto md:border md:border-border md:bg-card",
						props.isLoading && "opacity-60",
					)}
				>
					{props.isLoading ? (
						<ActivityIndicator accessibilityLabel="Loading more results" size="small" />
					) : (
						<AppIcon className="text-text" name="chevron-down" size={16} />
					)}
					<Text className="font-ui text-[15px] text-text md:text-[13px]">
						{props.isLoading ? "Loading..." : "Load more"}
					</Text>
				</Pressable>
			) : (
				<Text className="text-center font-ui text-xs text-text-subtle">
					End of {props.name} · {props.loaded.toLocaleString()} items
				</Text>
			)}
		</View>
	);
}
