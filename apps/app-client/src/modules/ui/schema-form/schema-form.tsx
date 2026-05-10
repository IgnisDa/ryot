import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { useForm } from "@tanstack/react-form";
import { Match } from "effect";
import type { ComponentProps, Ref } from "react";
import { useRef } from "react";
import { Text, type TextInput, View } from "react-native";

import { AppChip } from "@/modules/ui/chip";
import { FormMessage, FormTextInput } from "@/modules/ui/form";
import { AppSegmentedControl } from "@/modules/ui/segmented-control";
import { AppSwitch } from "@/modules/ui/switch";

import type { SchemaFileUpload } from "./file-upload";
import { pickUploadFile } from "./pick-upload-file";
import { SchemaFileField } from "./schema-file-field";
import {
	describeSchemaFormFields,
	schemaChoiceLabel,
	type SchemaFormField,
	type SchemaFormValue,
	type SchemaFormValues,
	validateSchemaFormValues,
} from "./schema-form-state";
import { SchemaMultiSelect } from "./schema-multi-select";

export function useSchemaForm(props: {
	schema: AppSchema | undefined;
	onSubmit: (values: SchemaFormValues) => void;
}) {
	return useForm({
		defaultValues: {} as SchemaFormValues,
		onSubmit: ({ value }) => props.onSubmit(value),
		errorVisibility: ({ state }) => state.submissionAttempts > 0,
		validators: [
			{
				triggers: [],
				run: ({ value, createErrorMap }) => {
					if (props.schema === undefined) {
						return undefined;
					}
					const validationErrors = validateSchemaFormValues(props.schema, value);
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

export type SchemaFormApi = ReturnType<typeof useSchemaForm>;

type SchemaTextInputProps = Pick<
	ComponentProps<typeof FormTextInput>,
	"autoComplete" | "autoCorrect" | "keyboardType" | "autoCapitalize" | "secureTextEntry"
>;

const isNumericField = (field: SchemaFormField) =>
	field.type === "number" || field.type === "integer";

const schemaStringArray = (value: SchemaFormValue): readonly string[] =>
	typeof value === "object" ? value : [];

const schemaText = (value: SchemaFormValue) =>
	value === undefined || typeof value === "object" ? "" : String(value);

const parseNumericValue = (text: string) => {
	const trimmed = text.trim();
	const parsed = Number(trimmed);
	return trimmed === "" || Number.isNaN(parsed) ? undefined : parsed;
};

const schemaTextInputProps = (field: SchemaFormField): SchemaTextInputProps => {
	if (field.secret) {
		return {
			autoCorrect: false,
			autoComplete: "off",
			secureTextEntry: true,
			autoCapitalize: "none",
		};
	}
	if (field.format === "url") {
		return {
			autoCorrect: false,
			keyboardType: "url",
			autoComplete: "url",
			autoCapitalize: "none",
		};
	}
	if (field.format === "email") {
		return {
			autoCorrect: false,
			autoComplete: "email",
			autoCapitalize: "none",
			keyboardType: "email-address",
		};
	}
	return { keyboardType: isNumericField(field) ? "numeric" : "default" };
};

function SchemaFieldControl(props: {
	readonly description: string;
	readonly isLastInput: boolean;
	readonly field: SchemaFormField;
	readonly value: SchemaFormValue;
	readonly inputRef: Ref<TextInput>;
	readonly uploadFile: SchemaFileUpload;
	readonly onSubmitEditing: () => void;
	readonly onChange: (value: SchemaFormValue) => void;
}) {
	const choices = props.field.choices ?? [];
	return Match.value(props.field.control).pipe(
		Match.when("switch", () => (
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
		Match.when("segmented", () => (
			<AppSegmentedControl
				label={props.field.label}
				onChange={props.onChange}
				value={schemaText(props.value)}
				segments={choices.map((choice) => ({
					value: choice.value,
					label: schemaChoiceLabel(choice),
				}))}
			/>
		)),
		Match.when("chips", () => (
			<View className="flex-row flex-wrap gap-1.5">
				{choices.map((choice) => (
					<AppChip
						role="radio"
						key={choice.value}
						className="px-2.5"
						label={schemaChoiceLabel(choice)}
						checked={props.value === choice.value}
						onPress={() => props.onChange(choice.value)}
					/>
				))}
			</View>
		)),
		Match.when("file", () => (
			<SchemaFileField
				pickFile={pickUploadFile}
				onChange={props.onChange}
				label={props.field.label}
				uploadFile={props.uploadFile}
				value={schemaText(props.value) === "" ? undefined : schemaText(props.value)}
				allowedFileExtensions={props.field.allowedFileExtensions ?? []}
			/>
		)),
		Match.when("multi-select", () => (
			<SchemaMultiSelect
				choices={choices}
				label={props.field.label}
				onChange={props.onChange}
				placeholder={props.description}
				selected={schemaStringArray(props.value)}
			/>
		)),
		Match.when("text", () => (
			<FormTextInput
				density="compact"
				inputRef={props.inputRef}
				{...schemaTextInputProps(props.field)}
				value={schemaText(props.value)}
				accessibilityLabel={props.field.label}
				onSubmitEditing={props.onSubmitEditing}
				placeholder={props.description || undefined}
				returnKeyType={props.isLastInput ? "go" : "next"}
				onChangeText={(text) =>
					props.onChange(isNumericField(props.field) ? parseNumericValue(text) : text)
				}
			/>
		)),
		Match.exhaustive,
	);
}

function SchemaFieldRow(props: {
	readonly isLastInput: boolean;
	readonly field: SchemaFormField;
	readonly value: SchemaFormValue;
	readonly inputRef: Ref<TextInput>;
	readonly error: string | undefined;
	readonly uploadFile: SchemaFileUpload;
	readonly onSubmitEditing: () => void;
	readonly onChange: (value: SchemaFormValue) => void;
}) {
	const showsDescriptionBelow =
		props.field.description !== "" &&
		(props.field.control === "chips" ||
			props.field.control === "file" ||
			props.field.control === "segmented");
	return (
		<View className="gap-1.5">
			<Text className="font-ui-medium text-xs text-text-muted">
				{props.field.label}
				{props.field.required ? <Text className="text-danger"> *</Text> : null}
			</Text>
			<SchemaFieldControl
				field={props.field}
				value={props.value}
				inputRef={props.inputRef}
				uploadFile={props.uploadFile}
				onChange={props.onChange}
				isLastInput={props.isLastInput}
				description={props.field.description}
				onSubmitEditing={props.onSubmitEditing}
			/>
			{showsDescriptionBelow ? (
				<Text className="font-ui text-xs text-text-subtle">{props.field.description}</Text>
			) : null}
			{props.error === undefined ? null : <FormMessage>{props.error}</FormMessage>}
		</View>
	);
}

export function SchemaForm(props: {
	readonly schema: AppSchema;
	readonly onChange: () => void;
	readonly form: SchemaFormApi;
	readonly uploadFile: SchemaFileUpload;
}) {
	const inputs = useRef(new Map<string, TextInput | null>());
	return (
		<props.form.Subscribe selector={(state) => state.values}>
			{(values) => {
				const description = describeSchemaFormFields(props.schema, values);
				const inputKeys = description.fields.flatMap((field) =>
					field.control === "text" ? [field.key] : [],
				);
				const submitFrom = (key: string) => {
					const next = inputKeys.at(inputKeys.indexOf(key) + 1);
					if (next === undefined) {
						void props.form.handleSubmit();
						return;
					}
					inputs.current.get(next)?.focus();
				};
				return (
					<View className="gap-3 rounded-lg bg-surface-2 p-3 md:bg-transparent md:p-0">
						{description.fields.map((field) => (
							<props.form.Field key={field.key} name={field.key}>
								{(formField) => (
									<SchemaFieldRow
										field={field}
										value={formField.value}
										uploadFile={props.uploadFile}
										error={formField.errors[0]?.message}
										isLastInput={inputKeys.at(-1) === field.key}
										onSubmitEditing={() => submitFrom(field.key)}
										inputRef={(instance) => {
											inputs.current.set(field.key, instance);
										}}
										onChange={(value) => {
											formField.handleChange(value);
											props.onChange();
										}}
									/>
								)}
							</props.form.Field>
						))}
						{description.unsupported.length === 0 ? null : (
							<Text className="font-ui text-xs text-text-subtle">
								Some fields are not supported in this app version.
							</Text>
						)}
					</View>
				);
			}}
		</props.form.Subscribe>
	);
}
