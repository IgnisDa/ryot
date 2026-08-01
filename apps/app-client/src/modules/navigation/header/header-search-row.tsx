import { useEffect, useEffectEvent } from "react";
import { ActivityIndicator, BackHandler, Platform, Pressable, TextInput, View } from "react-native";

import { AppIcon } from "@/modules/icons";

import { useSuspendedDrawerEdgeSwipe } from "../workspace-drawer";
import { HeaderLeadingControl } from "./header-control";

export function HeaderSearchRow(props: {
	value: string;
	label: string;
	onExit: () => void;
	onClear: () => void;
	onSubmit: () => void;
	isSearching?: boolean;
	onChange: (value: string) => void;
}) {
	const exit = useEffectEvent(() => props.onExit());
	useSuspendedDrawerEdgeSwipe();

	useEffect(() => {
		if (Platform.OS !== "android") {
			return undefined;
		}
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			exit();
			return true;
		});
		return () => subscription.remove();
	}, []);

	return (
		<View className="h-13.5 flex-row items-center gap-1.5 px-4">
			<HeaderLeadingControl icon="chevron-left" label="Exit search" onPress={props.onExit} />
			<View className="h-9.5 min-w-0 flex-1 flex-row items-center gap-2 rounded-pill border border-border-strong bg-surface-2 px-3">
				<AppIcon className="shrink-0 text-text-muted" name="search" size={16} />
				<TextInput
					autoFocus
					returnKeyType="go"
					value={props.value}
					placeholder={props.label}
					onChangeText={props.onChange}
					onSubmitEditing={props.onSubmit}
					accessibilityLabel={props.label}
					className="min-w-0 flex-1 py-0 font-ui text-[15px] text-text"
				/>
				{props.isSearching ? (
					<ActivityIndicator size="small" accessibilityLabel="Searching" />
				) : null}
				{props.value === "" ? null : (
					<Pressable
						hitSlop={10}
						onPress={props.onClear}
						accessibilityRole="button"
						accessibilityLabel="Clear search"
					>
						<AppIcon className="text-text-muted" name="circle-x" size={18} />
					</Pressable>
				)}
			</View>
		</View>
	);
}
