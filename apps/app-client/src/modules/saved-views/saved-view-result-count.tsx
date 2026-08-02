import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
	savedViewResultCount,
	savedViewTotalCount,
	type SavedViewCountState,
} from "./result-count";

const DUMMY_TOTAL = 1284;
const DUMMY_LATENCY_MS = 700;

export function SavedViewResultCount(props: {
	readonly loaded: number;
	readonly hasMore: boolean;
	readonly textClassName: string;
}) {
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const [state, setState] = useState<SavedViewCountState>({ status: "idle" });

	useEffect(() => () => clearTimeout(timer.current), []);

	function countAll() {
		setState({ status: "counting" });
		timer.current = setTimeout(
			() => setState({ status: "resolved", total: DUMMY_TOTAL }),
			DUMMY_LATENCY_MS,
		);
	}

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
					onPress={countAll}
					accessibilityRole="button"
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
