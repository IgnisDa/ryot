import { useHotkey } from "@tanstack/react-hotkeys";
import clsx from "clsx";
import type { RefObject } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { AppIcon } from "@/modules/icons";

export type AppSearchState = {
	readonly value: string;
	readonly query: string;
	readonly onClear: () => void;
	readonly isSearching: boolean;
	readonly onSubmit: () => void;
	readonly onChange: (value: string) => void;
};

export function AppSearchField(props: {
	readonly name: string;
	readonly className?: string;
	readonly showShortcut?: boolean;
	readonly search: AppSearchState;
	readonly inputRef?: RefObject<TextInput | null>;
}) {
	return (
		<View
			className={clsx(
				"h-9 min-w-0 flex-row items-center gap-2 rounded-lg border border-border-strong bg-bg px-2.5",
				props.className,
			)}
		>
			<AppIcon className="shrink-0 text-text-muted" name="search" size={15} />
			<TextInput
				returnKeyType="go"
				ref={props.inputRef}
				value={props.search.value}
				onChangeText={props.search.onChange}
				placeholder={`Search ${props.name}`}
				onSubmitEditing={props.search.onSubmit}
				accessibilityLabel={`Search ${props.name}`}
				className="min-w-0 flex-1 py-0 font-ui text-[13px] text-text"
			/>
			{props.search.value === "" && props.showShortcut ? (
				<View className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5">
					<Text className="font-mono text-[11px] text-text-subtle">/</Text>
				</View>
			) : null}
			{props.search.isSearching ? (
				<ActivityIndicator size="small" accessibilityLabel={`Searching ${props.name}`} />
			) : null}
			{props.search.value === "" ? null : (
				<Pressable
					accessibilityRole="button"
					onPress={props.search.onClear}
					accessibilityLabel="Clear search"
					className="rounded-pill focus-visible:outline-2 focus-visible:outline-accent"
				>
					<AppIcon className="text-text-muted" name="circle-x" size={15} />
				</Pressable>
			)}
		</View>
	);
}

export const useSearchFieldShortcut = (inputRef: RefObject<TextInput | null>) => {
	useHotkey("/", () => inputRef.current?.focus(), { stopPropagation: false });
};
