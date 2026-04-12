import type { AppSchema } from "@ryot/contract/schema/property-schema";
import clsx from "clsx";
import { Match } from "effect";
import { Pressable, Text, TextInput, View } from "react-native";

import {
	describeOptionFields,
	type OptionField,
	type OptionValue,
	type OptionValues,
} from "./options-form-state";

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

function OptionChip(props: {
	readonly label: string;
	readonly checked: boolean;
	readonly onPress: () => void;
	readonly role: "radio" | "checkbox";
}) {
	return (
		<Pressable
			onPress={props.onPress}
			accessibilityRole={props.role}
			accessibilityLabel={props.label}
			accessibilityState={{ checked: props.checked }}
			className={clsx(
				"h-7 items-center justify-center rounded-pill border px-2.5",
				props.checked && "border-accent-border bg-accent-soft",
				!props.checked && "border-border-strong",
			)}
		>
			<Text
				className={clsx(
					"font-ui-medium text-xs",
					props.checked && "text-accent-text",
					!props.checked && "text-text-muted",
				)}
			>
				{props.label}
			</Text>
		</Pressable>
	);
}

function OptionSwitch(props: {
	readonly label: string;
	readonly checked: boolean;
	readonly onChange: (value: boolean) => void;
}) {
	return (
		<Pressable
			accessibilityRole="switch"
			accessibilityLabel={props.label}
			accessibilityState={{ checked: props.checked }}
			onPress={() => props.onChange(!props.checked)}
			className={clsx(
				"h-6 w-10 justify-center rounded-pill p-0.5",
				props.checked && "bg-accent",
				!props.checked && "bg-surface-2",
			)}
		>
			<View className={clsx("h-5 w-5 rounded-pill bg-raised", props.checked && "self-end")} />
		</Pressable>
	);
}

function OptionControl(props: {
	readonly field: OptionField;
	readonly value: OptionValue;
	readonly description: string;
	readonly onChange: (value: OptionValue) => void;
}) {
	const selected = optionStringArray(props.value);
	const choices = props.field.options ?? [];
	return Match.value(props.field.type).pipe(
		Match.when("boolean", () => (
			<View className="flex-row items-center gap-2">
				<OptionSwitch
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
					<OptionChip
						key={choice}
						role="radio"
						label={choice}
						checked={props.value === choice}
						onPress={() => props.onChange(choice)}
					/>
				))}
			</View>
		)),
		Match.when("enum-array", () => (
			<View className="flex-row flex-wrap gap-1.5">
				{choices.map((choice) => (
					<OptionChip
						key={choice}
						label={choice}
						role="checkbox"
						checked={selected.includes(choice)}
						onPress={() =>
							props.onChange(
								selected.includes(choice)
									? selected.filter((current) => current !== choice)
									: [...selected, choice],
							)
						}
					/>
				))}
			</View>
		)),
		Match.orElse(() => (
			<TextInput
				returnKeyType="go"
				value={optionText(props.value)}
				accessibilityLabel={props.field.label}
				keyboardType={isNumericField(props.field) ? "numeric" : "default"}
				className="rounded-lg border border-border bg-raised px-3 py-2 font-ui text-sm text-text"
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
	readonly error: string | undefined;
	readonly onChange: (value: OptionValue) => void;
}) {
	return (
		<View className="gap-1.5">
			<Text className="font-ui-medium text-xs text-text-muted">
				{props.field.label}
				{props.field.required ? <Text className="text-danger"> *</Text> : null}
			</Text>
			<OptionControl
				description={props.field.description}
				field={props.field}
				value={props.value}
				onChange={props.onChange}
			/>
			{props.field.type === "boolean" || props.field.description === "" ? null : (
				<Text className="font-ui text-xs text-text-subtle">{props.field.description}</Text>
			)}
			{props.error === undefined ? null : (
				<Text className="font-ui text-xs text-danger">{props.error}</Text>
			)}
		</View>
	);
}

export function ProviderSearchOptionsForm(props: {
	readonly schema: AppSchema;
	readonly values: OptionValues;
	readonly errors: ReadonlyMap<string, string>;
	readonly onChange: (key: string, value: OptionValue) => void;
}) {
	const description = describeOptionFields(props.schema);
	return (
		<View className="gap-3 rounded-lg bg-surface-2 p-3 md:bg-transparent md:p-0">
			{description.fields.map((field) => (
				<OptionFieldRow
					field={field}
					key={field.key}
					value={props.values[field.key]}
					error={props.errors.get(field.key)}
					onChange={(value) => props.onChange(field.key, value)}
				/>
			))}
			{description.unsupported.length === 0 ? null : (
				<Text className="font-ui text-xs text-text-subtle">
					Some options are not supported in this app version.
				</Text>
			)}
		</View>
	);
}
