import { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import {
	type AppPropertyDefinition,
	type AppSchema,
	type PropertyValidationIssue,
	getOrderedAppSchemaFieldEntries,
	isAppSchemaPathEffectivelyRequired,
	isAppSchemaPathHidden,
} from "@ryot-app/contract/schema/property-schema";
import { hasPropertySecrets } from "@ryot-app/contract/schema/property-secrets";
import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { Button } from "../button";
import { Chip } from "../chips";
import { MultiSelect } from "../multi-select";
import { RadioGroup } from "../radio-group";
import { SegmentedControl } from "../segmented-control";
import { Select } from "../select";
import { Switch } from "../switch";
import { FieldMessage, TextField } from "../text-field";
import { SchemaAssetField } from "./asset/field";
import type { SchemaAssetUpload } from "./asset/upload";
import { localDateTime, utcDateTime } from "./datetime";
import { pickBrowserMediaFile, pickBrowserUploadFile } from "./file/browser-file";
import { SchemaFileField, type SchemaFileIcons } from "./file/field";
import type { SchemaFileUpload } from "./file/upload";
import type { SchemaOAuthConnect } from "./oauth/connect";
import { SchemaOAuthField } from "./oauth/field";
import {
	describeSchemaFormField,
	describeSchemaFormFields,
	initialSchemaFormValues,
	isFixedEnumProperty,
	propertyFormDefault,
	schemaChoiceLabel,
	schemaFormInput,
	schemaFormIssues,
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

const emptyValues: { readonly fields: SchemaFormValues } = { fields: {} };

export function useSchemaForm(props: {
	mode?: SchemaFormMode;
	schemas: readonly (AppSchema | undefined)[];
	onSubmit: (values: SchemaFormValues) => void;
}) {
	return useForm({
		defaultValues: emptyValues,
		onSubmit: ({ value }) => props.onSubmit(value.fields),
		errorVisibility: ({ state }) => state.submissionAttempts > 0,
		validators: [
			{
				triggers: [],
				run: ({ value, formApi, createErrorMap }) => {
					const issues = props.schemas.flatMap((schema) =>
						schema === undefined
							? []
							: [
									...validateSchemaFormValues(
										schema,
										value.fields,
										props.mode ?? "create",
										formApi?.defaultValues.fields,
									),
								],
					);
					if (issues.length === 0) {
						return undefined;
					}
					const errors = createErrorMap();
					errors.form = issues.map(([, message]) => message).join("; ");
					return errors;
				},
			},
		],
	});
}

export type SchemaFormApi = ReturnType<typeof useSchemaForm>;
export type SchemaAssetRenderer = (asset: AssetLocator) => ReactNode;

type SchemaFormProps = {
	readonly title?: string;
	readonly schema: AppSchema;
	readonly form: SchemaFormApi;
	readonly onChange: () => void;
	readonly mode?: SchemaFormMode;
	readonly icons: SchemaFormIcons;
	readonly uploadFile: SchemaFileUpload;
	readonly connectOAuth?: SchemaOAuthConnect;
	readonly uploadAsset?: SchemaAssetUpload;
	readonly oauthDisabledReason?: string;
	readonly renderAsset?: SchemaAssetRenderer;
	readonly timeZone?: string;
	readonly onReorder?: () => void;
};

type NodeProps = {
	readonly context: SchemaFormProps;
	readonly property: AppPropertyDefinition;
	readonly path: readonly string[];
	readonly value: unknown;
	readonly input: SchemaFormValues;
	readonly issues: readonly PropertyValidationIssue[];
	readonly addressable: boolean;
	readonly mode: SchemaFormMode;
	readonly onChange: (value: SchemaFormValue) => void;
};

const textValue = (value: unknown) =>
	typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? String(value)
		: "";
const isObjectValue = (value: unknown): value is Readonly<Record<string, JsonValue>> =>
	value !== null && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
const objectValue = (value: unknown): Readonly<Record<string, JsonValue>> =>
	isObjectValue(value) ? value : {};
const arrayValue = (value: unknown): readonly JsonValue[] =>
	Array.isArray(value) ? value.filter(isJsonValue) : [];
const isAsset = Schema.is(AssetLocator);
const samePath = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length && left.every((part, index) => part === right[index]);

function ObjectControl(props: NodeProps & { readonly excluded?: readonly string[] }) {
	if (props.property.type !== "object") {
		return null;
	}
	const values = objectValue(props.value);
	const fields = getOrderedAppSchemaFieldEntries(props.property.properties);
	return (
		<div className="flex min-w-0 flex-col gap-3 border-l border-border pl-3">
			{fields.map(([key, property]) => {
				if (props.excluded?.includes(key)) {
					return null;
				}
				return (
					<SchemaNode
						{...props}
						key={key}
						property={property}
						path={[...props.path, key]}
						value={
							Object.hasOwn(values, key)
								? values[key]
								: propertyFormDefault(
										property,
										props.context.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone,
									)
						}
						onChange={(value) => {
							const next = { ...values, [key]: value };
							if (value === undefined) {
								delete next[key];
							}
							props.onChange(
								Object.fromEntries(
									Object.entries(next).filter(
										(entry): entry is [string, JsonValue] => entry[1] !== undefined,
									),
								),
							);
						}}
					/>
				);
			})}
		</div>
	);
}

const newArrayItem = (property: AppPropertyDefinition, timeZone: string): JsonValue => {
	const initial = propertyFormDefault(property, timeZone);
	if (initial !== undefined) {
		return initial;
	}
	if (property.type === "object") {
		return {};
	}
	if (property.type === "array" || property.type === "enum-array") {
		return [];
	}
	if (property.type === "boolean") {
		return false;
	}
	return property.type === "string" ? "" : null;
};

function ArrayControl(props: NodeProps) {
	const values = arrayValue(props.value);
	const [rowState, setRowState] = useState<{
		readonly ids: readonly number[];
		readonly next: number;
	}>({ next: 0, ids: [] });
	let rows = rowState;
	if (rows.ids.length !== values.length) {
		const ids = rows.ids.slice(0, values.length);
		let next = rows.next;
		while (ids.length < values.length) {
			ids.push(next++);
		}
		rows = { ids, next };
		setRowState(rows);
	}
	const ids = rows.ids;
	if (props.property.type !== "array") {
		return null;
	}
	const item = props.property.items;
	const move = (index: number, destination: number) => {
		const reorder = <T,>(items: readonly T[]) => {
			const next = [...items];
			const [entry] = next.splice(index, 1);
			if (entry !== undefined) {
				next.splice(destination, 0, entry);
			}
			return next;
		};
		setRowState({ ...rows, ids: reorder(ids) });
		props.onChange(reorder(values));
		props.context.onReorder?.();
	};
	return (
		<div className="flex min-w-0 flex-col gap-3">
			{props.mode === "edit" && hasPropertySecrets(props.property) ? (
				<span className="text-xs text-text-subtle">
					Changing this list replaces it. Re-enter hidden secrets in every item.
				</span>
			) : null}
			{values.map((value, index) => (
				<div key={ids[index]} className="flex min-w-0 flex-col gap-2 border-l border-border pl-3">
					<SchemaNode
						{...props}
						value={value}
						mode="create"
						addressable={false}
						path={[...props.path, String(index)]}
						property={{ ...item, label: `${props.property.label} item ${index + 1}` }}
						onChange={(next) =>
							props.onChange(
								values.map((current, position) => (position === index ? (next ?? null) : current)),
							)
						}
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							aria-label={`Remove ${props.property.label} item ${index + 1}`}
							onClick={() => {
								setRowState({ ...rows, ids: ids.filter((_, position) => position !== index) });
								props.onChange(values.filter((_, position) => position !== index));
							}}
						>
							Remove
						</Button>
						<Button
							variant="ghost"
							disabled={index === 0}
							onClick={() => move(index, index - 1)}
							aria-label={`Move ${props.property.label} item ${index + 1} up`}
						>
							Move up
						</Button>
						<Button
							variant="ghost"
							disabled={index === values.length - 1}
							onClick={() => move(index, index + 1)}
							aria-label={`Move ${props.property.label} item ${index + 1} down`}
						>
							Move down
						</Button>
					</div>
				</div>
			))}
			<Button
				variant="secondary"
				className="self-start"
				aria-label={`Add ${props.property.label} item`}
				disabled={
					props.property.validation?.maxItems !== undefined &&
					values.length >= props.property.validation.maxItems
				}
				onClick={() => {
					props.onChange([
						...values,
						newArrayItem(
							item,
							props.context.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone,
						),
					]);
				}}
			>
				Add row
			</Button>
		</div>
	);
}

function AssetControl(props: NodeProps) {
	const { icons, uploadAsset, renderAsset } = props.context;
	if (uploadAsset === undefined || renderAsset === undefined) {
		return <FieldMessage>{`Uploads are not available for ${props.property.label}.`}</FieldMessage>;
	}
	const multiple = props.property.type === "array";
	const property = props.property.type === "array" ? props.property.items : props.property;
	let values: readonly JsonValue[] = arrayValue(props.value);
	if (!multiple) {
		values = isJsonValue(props.value) && props.value !== null ? [props.value] : [];
	}
	const assets = values.filter(isAsset);
	const occurrences = new Map<string, number>();
	const metadataRows = assets.map((asset, index) => {
		const locator = asset.type === "remote" ? asset.url : `${asset.type}:${asset.key}`;
		const occurrence = occurrences.get(locator) ?? 0;
		occurrences.set(locator, occurrence + 1);
		return { index, value: values[index], key: `${locator}:${occurrence}` };
	});
	const setValues = (next: readonly JsonValue[]) =>
		props.onChange(multiple ? next : (next[0] ?? null));
	return (
		<div className="flex flex-col gap-3">
			<SchemaAssetField
				icons={icons}
				value={assets}
				replace={!multiple}
				uploadAsset={uploadAsset}
				renderAsset={renderAsset}
				label={props.property.label}
				pickFile={pickBrowserMediaFile}
				onReorder={props.context.onReorder}
				maximum={props.property.type === "array" ? props.property.validation?.maxItems : 1}
				onChange={(next) => {
					setValues(
						next.map((asset) => {
							const retained = values.find(
								(value) => isAsset(value) && JSON.stringify(asset) === JSON.stringify(value),
							);
							if (retained !== undefined) {
								return retained;
							}
							const metadata = multiple
								? {}
								: Object.fromEntries(
										Object.entries(objectValue(values[0])).filter(
											([key]) => !["key", "url", "type"].includes(key),
										),
									);
							return { ...metadata, ...asset };
						}),
					);
				}}
			/>
			{metadataRows.map(({ key, value, index }) => (
				<ObjectControl
					{...props}
					key={key}
					value={value}
					property={property}
					excluded={["key", "url", "type"]}
					addressable={multiple ? false : props.addressable}
					path={multiple ? [...props.path, String(index)] : props.path}
					onChange={(next) =>
						setValues(
							values.map((current, position) => (position === index ? (next ?? null) : current)),
						)
					}
				/>
			))}
		</div>
	);
}

function NodeControl(props: NodeProps) {
	const { context, property } = props;
	const field = describeSchemaFormField(props.path.at(-1) ?? "", property, props.mode);
	const value = textValue(props.value);
	const choices = field.choices ?? [];
	if (
		(property.type === "enum" || property.type === "enum-array") &&
		property.choices.kind === "dynamic"
	) {
		return (
			<FieldMessage>{`Choices for ${property.label} have not been resolved (${property.choices.source}).`}</FieldMessage>
		);
	}
	switch (field.control) {
		case "object":
			return <ObjectControl {...props} />;
		case "list":
			return <ArrayControl {...props} />;
		case "asset":
		case "assets":
			return <AssetControl {...props} />;
		case "switch":
			return (
				<Switch label={property.label} onChange={props.onChange} checked={props.value === true} />
			);
		case "file":
			return (
				<SchemaFileField
					icons={context.icons}
					label={property.label}
					onChange={props.onChange}
					uploadFile={context.uploadFile}
					pickFile={pickBrowserUploadFile}
					value={value === "" ? undefined : value}
					allowedFileExtensions={field.allowedFileExtensions ?? []}
				/>
			);
		case "oauth-connection":
			return context.connectOAuth === undefined || field.oauthProvider === undefined ? (
				<FieldMessage>{`OAuth connections are not available for ${property.label}.`}</FieldMessage>
			) : (
				<SchemaOAuthField
					label={property.label}
					onChange={props.onChange}
					field={props.path[0] ?? ""}
					provider={field.oauthProvider}
					connect={context.connectOAuth}
					value={value === "" ? undefined : value}
					disabledReason={context.oauthDisabledReason}
				/>
			);
		case "multi-select":
			return (
				<MultiSelect
					choices={choices}
					label={property.label}
					onChange={props.onChange}
					checkIcon={context.icons.check}
					closeIcon={context.icons.close}
					searchIcon={context.icons.search}
					chevronIcon={context.icons.chevron}
					selected={arrayValue(props.value).filter(
						(item): item is string => typeof item === "string",
					)}
				/>
			);
		case "timezone": {
			const zones = Intl.supportedValuesOf("timeZone");
			return (
				<Select
					value={value}
					label={property.label}
					onChange={props.onChange}
					checkIcon={context.icons.check}
					searchIcon={context.icons.search}
					chevronIcon={context.icons.chevron}
					choices={(value === "" || zones.includes(value) ? zones : [value, ...zones]).map(
						(zone) => ({ value: zone, label: zone }),
					)}
				/>
			);
		}
		case "segmented":
			return (
				<SegmentedControl
					value={value}
					label={property.label}
					onChange={props.onChange}
					options={choices.map((choice) => ({
						value: choice.value,
						label: schemaChoiceLabel(choice),
						content: schemaChoiceLabel(choice),
					}))}
				/>
			);
		case "chips":
			return (
				<RadioGroup
					value={value}
					label={property.label}
					onChange={props.onChange}
					className="flex flex-wrap gap-1.5"
					options={choices.map((choice) => ({
						value: choice.value,
						label: schemaChoiceLabel(choice),
					}))}
					renderOption={(option, selected) => ({
						content: <Chip className="px-2.5" checked={selected} label={option.label} />,
					})}
				/>
			);
		case "text": {
			const numeric = property.type === "number" || property.type === "integer";
			const timeZone = context.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
			let displayedValue = value;
			if (field.format === "datetime") {
				const wallTime = objectValue(props.value).wallTime;
				displayedValue = typeof wallTime === "string" ? wallTime : localDateTime(value, timeZone);
			}
			let inputType = "text";
			if (property.secret) {
				inputType = "password";
			} else if (field.format === "datetime") {
				inputType = "datetime-local";
			} else if (field.format !== undefined) {
				inputType = field.format;
			}
			return (
				<TextField
					type={inputType}
					density="compact"
					value={displayedValue}
					aria-label={property.label}
					placeholder={property.description}
					inputMode={numeric ? "decimal" : undefined}
					autoComplete={property.secret ? "off" : undefined}
					step={field.format === "datetime" ? "any" : undefined}
					onChange={(event) => {
						const text = event.currentTarget.value;
						if (numeric) {
							let number: JsonValue = null;
							if (text.trim() !== "") {
								number = Number.isFinite(Number(text)) ? Number(text) : text;
							}
							props.onChange(number);
						} else if (field.format === "datetime") {
							props.onChange(
								text === "" ? null : (utcDateTime(text, timeZone) ?? { wallTime: text }),
							);
						} else if (field.format === "date") {
							props.onChange(text === "" ? null : text);
						} else {
							props.onChange(text);
						}
					}}
				/>
			);
		}
	}
	return null;
}

function NodeFrame(props: {
	readonly id: string;
	readonly label: string;
	readonly expandable: boolean;
	readonly invalid: boolean;
	readonly children: ReactNode;
}) {
	if (props.expandable) {
		return (
			<details
				open
				role="group"
				aria-labelledby={props.id}
				className="min-w-0 space-y-2"
				data-invalid={props.invalid ? "true" : undefined}
			>
				<summary id={props.id} className="cursor-pointer text-xs font-medium text-text-muted">
					{props.label}
				</summary>
				{props.children}
			</details>
		);
	}
	return (
		<div
			className="flex min-w-0 flex-col gap-1.5"
			data-invalid={props.invalid ? "true" : undefined}
		>
			<span id={props.id} className="text-xs font-medium text-text-muted">
				{props.label}
			</span>
			{props.children}
		</div>
	);
}

function SchemaNode(props: NodeProps) {
	const id = useId();
	const { value, property } = props;
	if (
		isFixedEnumProperty(property) ||
		(props.addressable && isAppSchemaPathHidden(props.context.schema, props.path, props.input))
	) {
		return null;
	}
	const required = props.addressable
		? isAppSchemaPathEffectivelyRequired(props.context.schema, props.path, props.input)
		: property.validation?.required === true;
	const readOnly = props.mode === "edit" && property.immutable === true;
	const absentObject =
		property.type === "object" &&
		!property.validation?.asset &&
		(value === undefined || value === null);
	const issue = props.issues.find((candidate) => {
		if (samePath(candidate.path, props.path)) {
			return true;
		}
		if (!props.path.every((segment, index) => candidate.path[index] === segment)) {
			return false;
		}
		return (
			absentObject ||
			(property.type === "object" &&
				!Object.hasOwn(property.properties, candidate.path[props.path.length] ?? ""))
		);
	});
	return (
		<NodeFrame
			id={`${id}-label`}
			invalid={issue !== undefined}
			label={`${property.label}${required ? " *" : ""}`}
			expandable={property.type === "object" || property.type === "array"}
		>
			<fieldset
				disabled={readOnly}
				aria-describedby={issue ? `${id}-error` : undefined}
				className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0 disabled:opacity-60"
			>
				{absentObject ? (
					<Button
						variant="secondary"
						className="self-start"
						onClick={() => {
							props.onChange(
								Object.fromEntries(
									Object.entries(
										initialSchemaFormValues(
											{ fields: property.properties },
											props.context.timeZone,
										),
									).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
								),
							);
						}}
					>{`Add ${property.label}`}</Button>
				) : (
					<NodeControl {...props} />
				)}
				{!required && value !== undefined && value !== null ? (
					<Button
						variant="ghost"
						className="self-start"
						onClick={() => props.onChange(null)}
						aria-label={`Clear ${property.label}`}
					>
						Clear
					</Button>
				) : null}
			</fieldset>
			{readOnly ? (
				<span className="text-xs text-text-subtle">Can't be changed after creation</span>
			) : null}
			{property.description !== property.label &&
			property.type !== "string" &&
			property.type !== "number" &&
			property.type !== "integer" ? (
				<span className="text-xs text-text-subtle">{property.description}</span>
			) : null}
			{props.mode === "edit" && property.secret ? (
				<span className="text-xs text-text-subtle">Leave blank to keep the current value.</span>
			) : null}
			{property.type === "datetime" ? (
				<span className="text-xs text-text-subtle">{`Time zone: ${props.context.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone}`}</span>
			) : null}
			{issue ? <FieldMessage id={`${id}-error`}>{issue.message}</FieldMessage> : null}
		</NodeFrame>
	);
}

function FocusInvalid(props: {
	readonly attempts: number;
	readonly root: RefObject<HTMLDivElement | null>;
}) {
	useLayoutEffect(() => {
		if (props.attempts > 0) {
			const control = props.root.current?.querySelector<HTMLElement>(
				'[data-invalid="true"] input, [data-invalid="true"] button, [data-invalid="true"] select',
			);
			let parent = control?.parentElement;
			while (parent) {
				if (parent instanceof HTMLDetailsElement) {
					parent.open = true;
				}
				parent = parent.parentElement;
			}
			control?.focus();
		}
	}, [props.attempts, props.root]);
	return null;
}

export function SchemaForm(props: SchemaFormProps) {
	const root = useRef<HTMLDivElement>(null);
	const mode = props.mode ?? "create";
	return (
		<props.form.Subscribe
			selector={(state) => ({ values: state.values.fields, attempts: state.submissionAttempts })}
		>
			{({ values, attempts }) => {
				const input = schemaFormInput(props.schema, values);
				const issues =
					attempts > 0
						? schemaFormIssues(props.schema, values, mode, props.form.defaultValues.fields)
						: [];
				const description = describeSchemaFormFields(props.schema, values, mode);
				return (
					<div
						ref={root}
						className="flex min-w-0 flex-col gap-3"
						onKeyDown={(event) => {
							if (
								event.key !== "Enter" ||
								!(event.target instanceof HTMLInputElement) ||
								event.target.type === "radio" ||
								event.target.type === "checkbox"
							) {
								return;
							}
							event.preventDefault();
							event.stopPropagation();
							const inputs = [
								...event.currentTarget.querySelectorAll<HTMLInputElement>(
									'input:not(:disabled):not([type="radio"]):not([type="checkbox"])',
								),
							].filter((control) => control.closest("details:not([open])") === null);
							const next = inputs[inputs.indexOf(event.target) + 1];
							if (next) {
								next.focus();
							} else {
								void props.form.handleSubmit();
							}
						}}
					>
						{props.title === undefined ? null : (
							<span className="text-xs font-medium text-text-subtle">{props.title}</span>
						)}
						<props.form.Field name="fields">
							{(formField) =>
								description.fields.map((field) => (
									<SchemaNode
										mode={mode}
										addressable
										input={input}
										key={field.key}
										context={props}
										issues={issues}
										path={[field.key]}
										value={values[field.key]}
										property={field.property}
										onChange={(value) => {
											formField.handleChange({ ...formField.value, [field.key]: value });
											props.onChange();
										}}
									/>
								))
							}
						</props.form.Field>
						{issues
							.filter((issue) => issue.path.length === 0)
							.map((issue) => (
								<FieldMessage key={issue.message}>{issue.message}</FieldMessage>
							))}
						<FocusInvalid root={root} attempts={attempts} />
					</div>
				);
			}}
		</props.form.Subscribe>
	);
}
