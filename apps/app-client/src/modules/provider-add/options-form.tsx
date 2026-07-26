import type { AppChoice, AppSchema } from "@ryot/contract/schema/property-schema";
import { useForm } from "@tanstack/react-form";
import clsx from "clsx";
import { Match } from "effect";
import { useDeferredValue, useState } from "react";
import { FlatList, Keyboard, Pressable, Text, TextInput, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { AppChip } from "@/modules/ui/chip";
import { FormMessage, FormTextInput } from "@/modules/ui/form";
import { AppModal } from "@/modules/ui/modal";
import { AppSwitch } from "@/modules/ui/switch";

import {
	describeOptionFields,
	type OptionField,
	type OptionValue,
	type OptionValues,
	validateOptionValues,
} from "./options-form-state";

export function useProviderOptionsForm(props: {
	schema: AppSchema | undefined;
	onSubmit: (values: OptionValues) => void;
}) {
	return useForm({
		defaultValues: {} as OptionValues,
		onSubmit: ({ value }) => props.onSubmit(value),
		errorVisibility: ({ state }) => state.submissionAttempts > 0,
		validators: [
			{
				triggers: [],
				run: ({ value, createErrorMap }) => {
					if (props.schema === undefined) {
						return undefined;
					}
					const validationErrors = validateOptionValues(props.schema, value);
					if (validationErrors.size === 0) {
						return undefined;
					}
					const errors = createErrorMap();
					for (const [key, message] of validationErrors) {
						errors.fields[key] = message;
					}
					return errors;
				},
			},
		],
	});
}

type ProviderOptionsFormApi = ReturnType<typeof useProviderOptionsForm>;

const isNumericField = (field: OptionField) => field.type === "number" || field.type === "integer";

const optionStringArray = (value: OptionValue): readonly string[] =>
	typeof value === "object" ? value : [];

const optionText = (value: OptionValue) =>
	value === undefined || typeof value === "object" ? "" : String(value);

const parseNumericOption = (text: string) => {
	const trimmed = text.trim();
	const parsed = Number(trimmed);
	return trimmed === "" || Number.isNaN(parsed) ? undefined : parsed;
};

const choiceLabel = (choice: AppChoice) => choice.label ?? choice.value;

function SearchableMultiSelect(props: {
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
			choiceLabel(choice).toLocaleLowerCase().includes(normalizedQuery),
	);
	const selectedLabels = props.selected.map((value) =>
		choiceLabel(props.choices.find((choice) => choice.value === value) ?? { value }),
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
										accessibilityLabel={choiceLabel(item)}
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
											{choiceLabel(item)}
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

function OptionControl(props: {
	readonly field: OptionField;
	readonly value: OptionValue;
	readonly description: string;
	readonly onSubmit: () => void;
	readonly onChange: (value: OptionValue) => void;
}) {
	const selected = optionStringArray(props.value);
	const choices = props.field.choices ?? [];
	return Match.value(props.field.type).pipe(
		Match.when("boolean", () => (
			<View className="flex-row items-center gap-2">
				<AppSwitch
					label={props.field.label}
					checked={props.value === true}
					onChange={(next) => props.onChange(next)}
				/>
				{props.description === "" ? null : (
					<Text className="font-ui text-xs text-text-subtle">{props.description}</Text>
				)}
			</View>
		)),
		Match.when("enum", () => (
			<View className="flex-row flex-wrap gap-1.5">
				{choices.map((choice) => (
					<AppChip
						role="radio"
						key={choice.value}
						className="px-2.5"
						label={choice.label ?? choice.value}
						checked={props.value === choice.value}
						onPress={() => props.onChange(choice.value)}
					/>
				))}
			</View>
		)),
		Match.when("enum-array", () => (
			<SearchableMultiSelect
				choices={choices}
				selected={selected}
				label={props.field.label}
				onChange={props.onChange}
				placeholder={props.description}
			/>
		)),
		Match.orElse(() => (
			<FormTextInput
				density="compact"
				returnKeyType="go"
				value={optionText(props.value)}
				onSubmitEditing={props.onSubmit}
				accessibilityLabel={props.field.label}
				placeholder={props.description || undefined}
				keyboardType={isNumericField(props.field) ? "numeric" : "default"}
				onChangeText={(text) =>
					props.onChange(isNumericField(props.field) ? parseNumericOption(text) : text)
				}
			/>
		)),
	);
}

function OptionFieldRow(props: {
	readonly field: OptionField;
	readonly value: OptionValue;
	readonly onSubmit: () => void;
	readonly error: string | undefined;
	readonly onChange: (value: OptionValue) => void;
}) {
	const hasPlaceholder = props.field.type !== "boolean" && props.field.type !== "enum";
	return (
		<View className="gap-1.5">
			<Text className="font-ui-medium text-xs text-text-muted">
				{props.field.label}
				{props.field.required ? <Text className="text-danger"> *</Text> : null}
			</Text>
			<OptionControl
				field={props.field}
				value={props.value}
				onSubmit={props.onSubmit}
				onChange={props.onChange}
				description={props.field.description}
			/>
			{hasPlaceholder || props.field.description === "" ? null : (
				<Text className="font-ui text-xs text-text-subtle">{props.field.description}</Text>
			)}
			{props.error === undefined ? null : <FormMessage>{props.error}</FormMessage>}
		</View>
	);
}

export function ProviderSearchOptionsForm(props: {
	readonly schema: AppSchema;
	readonly onChange: () => void;
	readonly form: ProviderOptionsFormApi;
}) {
	return (
		<props.form.Subscribe selector={(state) => state.values}>
			{(values) => {
				const description = describeOptionFields(props.schema, values);
				return (
					<View className="gap-3 rounded-lg bg-surface-2 p-3 md:bg-transparent md:p-0">
						{description.fields.map((option) => (
							<props.form.Field key={option.key} name={option.key}>
								{(field) => (
									<OptionFieldRow
										field={option}
										value={field.value}
										error={field.errors[0]?.message}
										onSubmit={() => void props.form.handleSubmit()}
										onChange={(value) => {
											field.handleChange(value);
											props.onChange();
										}}
									/>
								)}
							</props.form.Field>
						))}
						{description.unsupported.length === 0 ? null : (
							<Text className="font-ui text-xs text-text-subtle">
								Some options are not supported in this app version.
							</Text>
						)}
					</View>
				);
			}}
		</props.form.Subscribe>
	);
}
