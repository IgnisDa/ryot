import type { AppChoice } from "@ryot/contract/schema/property-schema";
import clsx from "clsx";
import { useDeferredValue, useState } from "react";
import { FlatList, Keyboard, Pressable, Text, TextInput, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { AppModal } from "@/modules/ui/modal";

import { schemaChoiceLabel } from "./schema-form-state";

export function SchemaMultiSelect(props: {
	readonly label: string;
	readonly placeholder: string;
	readonly selected: readonly string[];
	readonly choices: readonly AppChoice[];
	readonly onChange: (value: readonly string[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query);
	const selected = new Set(props.selected);
	const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
	const visibleChoices = props.choices.filter(
		(choice) =>
			selected.has(choice.value) ||
			schemaChoiceLabel(choice).toLocaleLowerCase().includes(normalizedQuery),
	);
	const selectedLabels = props.selected.map((value) =>
		schemaChoiceLabel(props.choices.find((choice) => choice.value === value) ?? { value }),
	);
	const close = () => {
		setOpen(false);
		setQuery("");
	};
	const toggle = (value: string) =>
		props.onChange(
			selected.has(value)
				? props.selected.filter((current) => current !== value)
				: [...props.selected, value],
		);
	const triggerText = (() => {
		if (selectedLabels.length === 0) {
			return props.placeholder || "Select options";
		}
		if (selectedLabels.length < 3) {
			return selectedLabels.join(", ");
		}
		return `${selectedLabels.slice(0, 2).join(", ")} +${selectedLabels.length - 2} selected`;
	})();

	return (
		<>
			<View className="flex-row items-center gap-2">
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={props.label}
					onPress={() => setOpen(true)}
					accessibilityHint="Opens a searchable list of options"
					className="min-h-10 min-w-0 flex-1 flex-row items-center justify-between rounded-lg border border-border bg-raised px-3"
				>
					<Text
						numberOfLines={1}
						className={clsx(
							"min-w-0 flex-1 font-ui text-sm",
							selectedLabels.length === 0 ? "text-text-subtle" : "text-text",
						)}
					>
						{triggerText}
					</Text>
					<AppIcon name="chevron-down" size={16} className="text-text-muted" />
				</Pressable>
				{selectedLabels.length === 0 ? null : (
					<Pressable
						accessibilityRole="button"
						className="rounded-md px-1.5 py-1"
						onPress={() => props.onChange([])}
						accessibilityLabel={`Clear ${props.label}`}
					>
						<Text className="font-ui-medium text-xs text-text-muted">Clear</Text>
					</Pressable>
				)}
			</View>

			<AppModal
				visible={open}
				onClose={close}
				closeLabel="Close options"
				className="items-center justify-center p-4"
			>
				<View className="h-[80%] max-h-[80%] w-full max-w-xl rounded-xl border border-border bg-surface p-4 shadow-card md:h-auto">
					<View className="mb-3 flex-row items-center justify-between">
						<Text className="font-ui-semibold text-base text-text">{props.label}</Text>
						<Pressable
							onPress={close}
							className="rounded-md p-1"
							accessibilityRole="button"
							accessibilityLabel="Close options"
						>
							<AppIcon name="x" size={17} className="text-text-muted" />
						</Pressable>
					</View>
					<View className="mb-3 h-10 flex-row items-center gap-2 rounded-lg border border-border bg-raised px-3">
						<AppIcon name="search" size={15} className="text-text-subtle" />
						<TextInput
							value={query}
							returnKeyType="go"
							autoCorrect={false}
							onChangeText={setQuery}
							placeholder="Search options"
							onSubmitEditing={() => Keyboard.dismiss()}
							accessibilityLabel={`Search ${props.label}`}
							className="min-w-0 flex-1 font-ui text-sm text-text"
						/>
					</View>
					{selectedLabels.length === 0 ? null : (
						<Pressable
							accessibilityRole="button"
							onPress={() => props.onChange([])}
							accessibilityLabel={`Clear ${props.label}`}
							className="mb-2 self-start rounded-md px-1.5 py-1"
						>
							<Text className="font-ui-medium text-xs text-text-muted">Clear selections</Text>
						</Pressable>
					)}
					<View className="min-h-0 flex-1">
						<FlatList
							data={visibleChoices}
							keyboardShouldPersistTaps="handled"
							keyExtractor={(choice) => choice.value}
							renderItem={({ item }) => {
								const checked = selected.has(item.value);
								return (
									<Pressable
										accessibilityRole="checkbox"
										accessibilityState={{ checked }}
										onPress={() => toggle(item.value)}
										accessibilityLabel={schemaChoiceLabel(item)}
										className="min-h-10 flex-row items-center gap-3 rounded-lg px-2 py-2"
									>
										<View
											className={clsx(
												"h-5 w-5 items-center justify-center rounded border",
												checked && "border-accent bg-accent",
												!checked && "border-border-strong bg-raised",
											)}
										>
											{checked ? <AppIcon name="check" size={13} className="text-white" /> : null}
										</View>
										<Text className="min-w-0 flex-1 font-ui text-sm text-text">
											{schemaChoiceLabel(item)}
										</Text>
									</Pressable>
								);
							}}
						/>
					</View>
					{visibleChoices.length === 0 ? (
						<Text className="py-4 text-center font-ui text-sm text-text-muted">
							No matching options.
						</Text>
					) : null}
				</View>
			</AppModal>
		</>
	);
}
