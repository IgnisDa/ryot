import clsx from "clsx";
import { useEffect, type RefObject } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";

import { AppIcon } from "@/modules/icons";

export type SavedViewSearch = {
	readonly value: string;
	readonly query: string;
	readonly resultLabel: string;
	readonly onClear: () => void;
	readonly isSearching: boolean;
	readonly onSubmit: () => void;
	readonly onChange: (value: string) => void;
};

export function SavedViewSearchField(props: {
	readonly name: string;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly autoFocus?: boolean;
	readonly showShortcut?: boolean;
	readonly search: SavedViewSearch;
	readonly inputRef?: RefObject<TextInput | null>;
}) {
	return (
		<View
			className={clsx(
				"h-9 min-w-0 flex-row items-center gap-2 rounded-lg border border-border-strong bg-bg px-2.5",
				props.className,
				props.disabled && "opacity-50",
			)}
		>
			<AppIcon className="shrink-0 text-text-muted" name="search" size={15} />
			<TextInput
				returnKeyType="go"
				ref={props.inputRef}
				editable={!props.disabled}
				autoFocus={props.autoFocus}
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
				<ActivityIndicator size="small" accessibilityLabel="Searching saved view" />
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

export const useSavedViewSearchShortcut = (
	inputRef: RefObject<TextInput | null>,
	enabled: boolean,
) => {
	useEffect(() => {
		if (!enabled || Platform.OS !== "web") {
			return undefined;
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target;
			if (
				event.key !== "/" ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				(target instanceof HTMLElement &&
					(target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)))
			) {
				return;
			}
			event.preventDefault();
			inputRef.current?.focus();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [enabled, inputRef]);
};
