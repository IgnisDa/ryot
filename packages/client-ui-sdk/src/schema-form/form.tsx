import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { useForm } from "@tanstack/react-form";
import { Match } from "effect";
import { useRef, type ComponentProps, type ReactNode, type Ref } from "react";

import { Chip } from "../chips";
import { Button } from "../index";
import { MultiSelect } from "../multi-select";
import { RadioGroup } from "../radio-group";
import { SegmentedControl } from "../segmented-control";
import { Switch } from "../switch";
import { FieldMessage, TextField } from "../text-field";
import { pickBrowserUploadFile } from "./file/browser-file";
import { SchemaFileField, type SchemaFileIcons } from "./file/field";
import type { SchemaFileUpload } from "./file/upload";
import {
	describeSchemaFormFields,
	isRetainedSecretField,
	schemaChoiceLabel,
	type SchemaFormArrayValue,
	type SchemaFormField,
	type SchemaFormMode,
	type SchemaFormValue,
	type SchemaFormValues,
	validateSchemaFormValues,
} from "./state";

export type SchemaFormIcons = SchemaFileIcons & {
	readonly check: ReactNode;
	readonly close: ReactNode;
	readonly search: ReactNode;
	readonly chevron: ReactNode;
};

export function useSchemaForm(props: {
	mode?: SchemaFormMode;
	schemas: readonly (AppSchema | undefined)[];
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
					const validationErrors = props.schemas.flatMap((schema) =>
						schema === undefined
							? []
							: [...validateSchemaFormValues(schema, value, props.mode ?? "create")],
					);
					if (validationErrors.length === 0) {
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
	ComponentProps<"input">,
	"type" | "inputMode" | "autoComplete" | "autoCapitalize"
>;

const isNumericField = (field: SchemaFormField) =>
	field.type === "number" || field.type === "integer";

const schemaArray = (value: SchemaFormValue): readonly SchemaFormArrayValue[] =>
	Array.isArray(value) ? value : [];

const schemaStringArray = (value: SchemaFormValue): readonly string[] =>
	schemaArray(value).filter((item): item is string => typeof item === "string");

const schemaText = (value: SchemaFormValue) =>
	value === undefined || typeof value === "object" ? "" : String(value);

const parseNumericValue = (text: string) => {
	const trimmed = text.trim();
	const parsed = Number(trimmed);
	return trimmed === "" || Number.isNaN(parsed) ? undefined : parsed;
};

const parseArrayNumericValue = (text: string) => {
	const trimmed = text.trim();
	if (trimmed === "") {
		return "";
	}
	const parsed = Number(trimmed);
	return Number.isNaN(parsed) ? text : parsed;
};

const schemaTextInputProps = (field: SchemaFormField): SchemaTextInputProps => {
	if (field.secret) {
		return { type: "password", autoComplete: "off", autoCapitalize: "none" };
	}
	if (field.format === "url") {
		return { type: "url", inputMode: "url", autoComplete: "url", autoCapitalize: "none" };
	}
	if (field.format === "email") {
		return { type: "email", inputMode: "email", autoComplete: "email", autoCapitalize: "none" };
	}
	return { type: "text", inputMode: isNumericField(field) ? "numeric" : "text" };
};

const submitOnEnter = (onSubmitEditing: () => void) => (event: { key: string }) => {
	if (event.key === "Enter") {
		onSubmitEditing();
	}
};

function SchemaArrayControl(props: {
	readonly field: SchemaFormField;
	readonly value: SchemaFormValue;
	readonly onSubmitEditing: () => void;
	readonly inputRef: Ref<HTMLInputElement>;
	readonly onChange: (value: SchemaFormValue) => void;
}) {
	const nextRowId = useRef(0);
	const rowIds = useRef<string[]>([]);
	const item = props.field.arrayItem;
	if (item === undefined) {
		return null;
	}
	const values = schemaArray(props.value);
	while (rowIds.current.length < values.length) {
		rowIds.current.push(`${props.field.key}-${nextRowId.current}`);
		nextRowId.current += 1;
	}
	if (rowIds.current.length > values.length) {
		rowIds.current.length = values.length;
	}
	const rows = rowIds.current.map((id, index) => ({ id, value: values[index] }));
	const replace = (index: number, value: SchemaFormArrayValue) =>
		props.onChange(
			values.map((current, currentIndex) => (currentIndex === index ? value : current)),
		);
	const maximum = props.field.arrayValidation?.maxItems;
	return (
		<div className="flex flex-col gap-2">
			{rows.map((row, index) => (
				<div key={row.id} className="flex flex-row items-center gap-2">
					<div className="flex min-w-0 flex-1">
						{item.type === "boolean" ? (
							<Switch
								checked={row.value === true}
								label={`${item.label} ${index + 1}`}
								onChange={(next) => replace(index, next)}
							/>
						) : (
							<TextField
								density="compact"
								className="min-w-0 flex-1"
								value={String(row.value)}
								placeholder={item.description}
								onKeyDown={submitOnEnter(props.onSubmitEditing)}
								aria-label={`${props.field.label} item ${index + 1}`}
								ref={index === 0 ? props.inputRef : undefined}
								type={item.secret === true ? "password" : "text"}
								autoComplete={item.secret === true ? "off" : undefined}
								autoCapitalize={item.secret === true ? "none" : undefined}
								inputMode={item.type === "string" ? "text" : "numeric"}
								onChange={(event) =>
									replace(
										index,
										item.type === "string"
											? event.currentTarget.value
											: parseArrayNumericValue(event.currentTarget.value),
									)
								}
							/>
						)}
					</div>
					<Button
						variant="secondary"
						aria-label={`Remove ${props.field.label} item ${index + 1}`}
						onClick={() => {
							rowIds.current.splice(index, 1);
							props.onChange(values.filter((_, currentIndex) => currentIndex !== index));
						}}
					>
						Remove
					</Button>
				</div>
			))}
			<Button
				variant="secondary"
				className="self-start"
				aria-label={`Add ${props.field.label} item`}
				disabled={maximum !== undefined && values.length >= maximum}
				onClick={() => {
					rowIds.current.push(`${props.field.key}-${nextRowId.current}`);
					nextRowId.current += 1;
					props.onChange([...values, item.type === "boolean" ? false : ""]);
				}}
			>
				Add row
			</Button>
		</div>
	);
}

function SchemaFieldControl(props: {
	readonly description: string;
	readonly icons: SchemaFormIcons;
	readonly field: SchemaFormField;
	readonly value: SchemaFormValue;
	readonly onSubmitEditing: () => void;
	readonly uploadFile: SchemaFileUpload;
	readonly inputRef: Ref<HTMLInputElement>;
	readonly onChange: (value: SchemaFormValue) => void;
}) {
	const choices = props.field.choices ?? [];
	return Match.value(props.field.control).pipe(
		Match.when("list", () => (
			<SchemaArrayControl
				field={props.field}
				value={props.value}
				inputRef={props.inputRef}
				onChange={props.onChange}
				onSubmitEditing={props.onSubmitEditing}
			/>
		)),
		Match.when("switch", () => (
			<div className="flex flex-row items-center gap-2">
				<Switch
					label={props.field.label}
					checked={props.value === true}
					onChange={(next) => props.onChange(next)}
				/>
				{props.description === "" ? null : (
					<span className="text-xs text-text-subtle">{props.description}</span>
				)}
			</div>
		)),
		Match.when("segmented", () => (
			<SegmentedControl
				className="self-start"
				optionClassName="px-3"
				label={props.field.label}
				onChange={props.onChange}
				value={schemaText(props.value)}
				options={choices.map((choice) => ({
					value: choice.value,
					label: schemaChoiceLabel(choice),
					content: schemaChoiceLabel(choice),
				}))}
			/>
		)),
		Match.when("chips", () => (
			<RadioGroup
				label={props.field.label}
				onChange={props.onChange}
				value={schemaText(props.value)}
				className="flex flex-row flex-wrap gap-1.5"
				renderOption={(option, selected) => ({
					content: <Chip className="px-2.5" label={option.label} checked={selected} />,
				})}
				options={choices.map((choice) => ({
					value: choice.value,
					label: schemaChoiceLabel(choice),
				}))}
			/>
		)),
		Match.when("file", () => (
			<SchemaFileField
				icons={props.icons}
				onChange={props.onChange}
				label={props.field.label}
				uploadFile={props.uploadFile}
				pickFile={pickBrowserUploadFile}
				allowedFileExtensions={props.field.allowedFileExtensions ?? []}
				value={schemaText(props.value) === "" ? undefined : schemaText(props.value)}
			/>
		)),
		Match.when("multi-select", () => (
			<MultiSelect
				choices={choices}
				label={props.field.label}
				onChange={props.onChange}
				checkIcon={props.icons.check}
				closeIcon={props.icons.close}
				searchIcon={props.icons.search}
				placeholder={props.description}
				chevronIcon={props.icons.chevron}
				selected={schemaStringArray(props.value)}
			/>
		)),
		Match.when("text", () => (
			<TextField
				density="compact"
				ref={props.inputRef}
				{...schemaTextInputProps(props.field)}
				value={schemaText(props.value)}
				placeholder={props.description}
				aria-label={props.field.label}
				onKeyDown={submitOnEnter(props.onSubmitEditing)}
				onChange={(event) =>
					props.onChange(
						isNumericField(props.field)
							? parseNumericValue(event.currentTarget.value)
							: event.currentTarget.value,
					)
				}
			/>
		)),
		Match.exhaustive,
	);
}

function SchemaFieldRow(props: {
	readonly mode: SchemaFormMode;
	readonly icons: SchemaFormIcons;
	readonly field: SchemaFormField;
	readonly value: SchemaFormValue;
	readonly error: string | undefined;
	readonly onSubmitEditing: () => void;
	readonly uploadFile: SchemaFileUpload;
	readonly inputRef: Ref<HTMLInputElement>;
	readonly onChange: (value: SchemaFormValue) => void;
}) {
	const retainsSecret = isRetainedSecretField(props.field, props.mode);
	const showsDescriptionBelow =
		props.field.description !== "" &&
		(props.field.control === "chips" ||
			props.field.control === "file" ||
			props.field.control === "list" ||
			props.field.control === "segmented");
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-xs font-medium text-text-muted">
				{props.field.label}
				{props.field.required && !retainsSecret ? <span className="text-danger"> *</span> : null}
			</span>
			<SchemaFieldControl
				icons={props.icons}
				field={props.field}
				value={props.value}
				inputRef={props.inputRef}
				onChange={props.onChange}
				uploadFile={props.uploadFile}
				description={props.field.description}
				onSubmitEditing={props.onSubmitEditing}
			/>
			{showsDescriptionBelow ? (
				<span className="text-xs text-text-subtle">{props.field.description}</span>
			) : null}
			{retainsSecret ? (
				<span className="text-xs text-text-subtle">Leave blank to keep the current value.</span>
			) : null}
			{props.error === undefined ? null : <FieldMessage>{props.error}</FieldMessage>}
		</div>
	);
}

export function SchemaForm(props: {
	readonly title?: string;
	readonly schema: AppSchema;
	readonly form: SchemaFormApi;
	readonly onChange: () => void;
	readonly mode?: SchemaFormMode;
	readonly icons: SchemaFormIcons;
	readonly uploadFile: SchemaFileUpload;
}) {
	const mode = props.mode ?? "create";
	const inputs = useRef(new Map<string, HTMLInputElement | null>());
	return (
		<props.form.Subscribe selector={(state) => state.values}>
			{(values) => {
				const description = describeSchemaFormFields(props.schema, values);
				if (description.fields.length === 0 && description.unsupported.length === 0) {
					return null;
				}
				const inputKeys = description.fields.flatMap((field) =>
					field.control === "text" ||
					(field.control === "list" && field.arrayItem?.type !== "boolean")
						? [field.key]
						: [],
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
					<div className="flex flex-col gap-2">
						{props.title === undefined ? null : (
							<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
								{props.title}
							</span>
						)}
						<div className="flex flex-col gap-3 rounded-lg bg-surface-2 p-3 md:bg-transparent md:p-0">
							{description.fields.map((field) => (
								<props.form.Field key={field.key} name={field.key}>
									{(formField) => (
										<SchemaFieldRow
											mode={mode}
											field={field}
											icons={props.icons}
											value={formField.value}
											uploadFile={props.uploadFile}
											error={formField.errors[0]?.message}
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
								<span className="text-xs text-text-subtle">
									Some fields are not supported in this app version.
								</span>
							)}
						</div>
					</div>
				);
			}}
		</props.form.Subscribe>
	);
}
