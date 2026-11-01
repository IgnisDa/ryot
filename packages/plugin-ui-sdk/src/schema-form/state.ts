import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import {
	type AppArrayPropertyValidation,
	type AppChoice,
	type AppPropertyDefinition,
	type AppSchema,
	getOrderedAppSchemaFieldEntries,
	isAppSchemaPathEffectivelyRequired,
	isAppSchemaPathHidden,
	type PropertyValidationIssue,
} from "@ryot-app/contract/schema/property-schema";
import { hasPropertySecrets } from "@ryot-app/contract/schema/property-secrets";
import {
	decodeAppSchemaPropertyValues,
	parseAppSchemaPropertiesSafe,
} from "@ryot-app/contract/schema/property-values";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Result } from "effect";

export type SchemaFormMode = "edit" | "create";
export type SchemaFormValue = JsonValue | undefined;
export type SchemaFormValues = Readonly<Record<string, unknown>>;
export type SchemaFormTextFormat = "url" | "date" | "email" | "datetime";
export type SchemaFormControl =
	| "list"
	| "text"
	| "file"
	| "asset"
	| "chips"
	| "assets"
	| "object"
	| "switch"
	| "timezone"
	| "segmented"
	| "multi-select"
	| "oauth-connection";

export type SchemaFormField = {
	readonly key: string;
	readonly label: string;
	readonly secret: boolean;
	readonly readOnly: boolean;
	readonly required: boolean;
	readonly description: string;
	readonly control: SchemaFormControl;
	readonly property: AppPropertyDefinition;
	readonly oauthProvider: string | undefined;
	readonly format: undefined | SchemaFormTextFormat;
	readonly choices: undefined | readonly AppChoice[];
	readonly arrayItem: undefined | AppPropertyDefinition;
	readonly type: "assets" | AppPropertyDefinition["type"];
	readonly allowedFileExtensions: undefined | readonly string[];
	readonly arrayValidation: undefined | AppArrayPropertyValidation;
};

export const schemaChoiceLabel = (choice: AppChoice) => choice.label ?? choice.value;

export const isFixedEnumProperty = (property: AppPropertyDefinition) =>
	property.type === "enum" &&
	property.defaultValue !== undefined &&
	property.choices.kind === "static" &&
	property.choices.values.length === 1;

export const isAssetProperty = (property: AppPropertyDefinition) =>
	property.type === "object" && property.validation?.asset === true;

const schemaFieldControl = (property: AppPropertyDefinition): SchemaFormControl => {
	if (isAssetProperty(property)) {
		return "asset";
	}
	if (property.type === "object") {
		return "object";
	}
	if (property.type === "boolean") {
		return "switch";
	}
	if (property.type === "string") {
		if (property.format?.kind === "upload") {
			return "file";
		}
		if (property.format?.kind === "oauth-connection") {
			return "oauth-connection";
		}
		if (property.format?.kind === "timezone") {
			return "timezone";
		}
	}
	if (property.type === "enum-array") {
		return "multi-select";
	}
	if (property.type === "array") {
		return isAssetProperty(property.items) ? "assets" : "list";
	}
	if (property.type !== "enum" || property.choices.kind !== "static") {
		return "text";
	}
	const choices = property.choices.values;
	return choices.length > 1 &&
		choices.length <= 3 &&
		choices.every((choice) => schemaChoiceLabel(choice).length <= 12)
		? "segmented"
		: "chips";
};

export const describeSchemaFormField = (
	key: string,
	property: AppPropertyDefinition,
	mode: SchemaFormMode,
	required = property.validation?.required === true,
): SchemaFormField => {
	const control = schemaFieldControl(property);
	let format: undefined | SchemaFormTextFormat;
	if (property.type === "date" || property.type === "datetime") {
		format = property.type;
	} else if (
		property.type === "string" &&
		(property.format?.kind === "url" || property.format?.kind === "email")
	) {
		format = property.format.kind;
	}
	return {
		key,
		format,
		control,
		property,
		required,
		label: property.label,
		secret: property.secret === true,
		description: property.description,
		type: control === "assets" ? "assets" : property.type,
		readOnly: mode === "edit" && property.immutable === true,
		arrayItem: property.type === "array" ? property.items : undefined,
		arrayValidation:
			property.type === "array" || property.type === "enum-array" ? property.validation : undefined,
		oauthProvider:
			property.type === "string" && property.format?.kind === "oauth-connection"
				? property.format.provider
				: undefined,
		allowedFileExtensions:
			property.type === "string" && property.format?.kind === "upload"
				? property.format.allowedFileExtensions
				: undefined,
		choices:
			(property.type === "enum" || property.type === "enum-array") &&
			property.choices.kind === "static"
				? property.choices.values
				: undefined,
	};
};

export const isJsonObjectValue = (value: unknown): value is Readonly<Record<string, JsonValue>> =>
	isObjectRecord(value) && isJsonValue(value);

export const propertyFormDefault = (
	property: AppPropertyDefinition,
	timeZone: string,
): SchemaFormValue => {
	if (isJsonValue(property.defaultValue)) {
		return property.defaultValue;
	}
	return property.type === "string" && property.format?.kind === "timezone" ? timeZone : undefined;
};

export const initialSchemaFormValues = (
	schema: AppSchema,
	timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
	stored: Readonly<Record<string, unknown>> = {},
): SchemaFormValues => ({
	...(schema.unknownKeys === "passthrough"
		? Object.fromEntries(
				Object.entries(stored).filter((entry): entry is [string, JsonValue] =>
					isJsonValue(entry[1]),
				),
			)
		: {}),
	...Object.fromEntries(
		getOrderedAppSchemaFieldEntries(schema.fields).map(([key, property]) => [
			key,
			isJsonValue(stored[key]) ? stored[key] : propertyFormDefault(property, timeZone),
		]),
	),
});

const propertyPayload = (
	property: AppPropertyDefinition,
	value: unknown,
	path: readonly string[],
	schema: AppSchema,
	input: SchemaFormValues,
	addressable: boolean,
	mode: SchemaFormMode,
	original: unknown,
): SchemaFormValue => {
	if (addressable && isAppSchemaPathHidden(schema, path, input)) {
		return undefined;
	}
	if (
		mode === "edit" &&
		property.type === "array" &&
		hasPropertySecrets(property) &&
		JSON.stringify(value) === JSON.stringify(original)
	) {
		return undefined;
	}
	if (isFixedEnumProperty(property) && isJsonValue(property.defaultValue)) {
		return property.defaultValue;
	}
	if (value === undefined) {
		return propertyFormDefault(property, Intl.DateTimeFormat().resolvedOptions().timeZone);
	}
	if (value === null) {
		return null;
	}
	if (property.secret && value === "" && mode === "edit") {
		return undefined;
	}
	if (property.type === "object" && isJsonObjectValue(value)) {
		const entries: [string, JsonValue][] = [];
		if (property.unknownKeys === "passthrough" || property.unknownKeys === "strict") {
			for (const [key, child] of Object.entries(value)) {
				if (!Object.hasOwn(property.properties, key) && isJsonValue(child)) {
					entries.push([key, child]);
				}
			}
		}
		for (const [key, child] of Object.entries(property.properties)) {
			const next = propertyPayload(
				child,
				value[key],
				[...path, key],
				schema,
				input,
				addressable,
				mode,
				isJsonObjectValue(original) ? original[key] : undefined,
			);
			if (next !== undefined) {
				entries.push([key, next]);
			}
		}
		return Object.fromEntries(entries);
	}
	if (property.type === "array" && Array.isArray(value)) {
		return value.map(
			(item, index) =>
				propertyPayload(
					property.items,
					item,
					[...path, String(index)],
					schema,
					input,
					false,
					"create",
					undefined,
				) ?? null,
		);
	}
	return isJsonValue(value) ? value : undefined;
};

const rawPayload = (
	schema: AppSchema,
	values: SchemaFormValues,
	mode: SchemaFormMode = "create",
	original: SchemaFormValues = {},
): Record<string, JsonValue> => {
	const payload = new Map<string, JsonValue>();
	if (schema.unknownKeys === "passthrough") {
		for (const [key, value] of Object.entries(original)) {
			if (!Object.hasOwn(schema.fields, key) && isJsonValue(value)) {
				payload.set(key, value);
			}
		}
	}
	for (const [key, property] of Object.entries(schema.fields)) {
		const value = propertyPayload(
			property,
			values[key],
			[key],
			schema,
			values,
			true,
			mode,
			original[key],
		);
		if (value !== undefined) {
			payload.set(key, value);
		}
	}
	return Object.fromEntries(payload);
};

export const schemaFormInput = (schema: AppSchema, values: SchemaFormValues): SchemaFormValues => {
	const seeded = { ...initialSchemaFormValues(schema), ...values };
	const decoded = decodeAppSchemaPropertyValues(schema, rawPayload(schema, seeded));
	let input: SchemaFormValues = Result.isSuccess(decoded) ? decoded.success : seeded;
	const fields = Object.keys(schema.fields).length + (schema.rules?.length ?? 0);
	for (let pass = 0; pass <= fields; pass++) {
		const next = rawPayload(schema, input);
		if (JSON.stringify(next) === JSON.stringify(input)) {
			return next;
		}
		input = next;
	}
	return input;
};

export const describeSchemaFormFields = (
	schema: AppSchema,
	values: SchemaFormValues = {},
	mode: SchemaFormMode = "create",
) => {
	const input = schemaFormInput(schema, values);
	return {
		fields: getOrderedAppSchemaFieldEntries(schema.fields).flatMap(([key, property]) =>
			isAppSchemaPathHidden(schema, [key], input) || isFixedEnumProperty(property)
				? []
				: [
						describeSchemaFormField(
							key,
							property,
							mode,
							isAppSchemaPathEffectivelyRequired(schema, [key], input),
						),
					],
		),
	};
};

const retainedSecretPaths = (
	property: AppPropertyDefinition,
	value: unknown,
	path: readonly string[],
	original: unknown,
): readonly (readonly string[])[] => {
	if (property.secret && (value === undefined || value === "")) {
		return [path];
	}
	if (
		property.type === "array" &&
		hasPropertySecrets(property) &&
		JSON.stringify(value) === JSON.stringify(original)
	) {
		return [path];
	}
	if (property.type === "object" && isJsonObjectValue(value)) {
		return Object.entries(property.properties).flatMap(([key, child]) =>
			retainedSecretPaths(
				child,
				value[key],
				[...path, key],
				isJsonObjectValue(original) ? original[key] : undefined,
			),
		);
	}
	return [];
};

const schemaFormSubmission = (
	schema: AppSchema,
	values: SchemaFormValues,
	mode: SchemaFormMode,
	original: SchemaFormValues,
) => {
	const payload = rawPayload(schema, schemaFormInput(schema, values), mode, original);
	const parsed = parseAppSchemaPropertiesSafe({
		properties: payload,
		propertiesSchema: schema,
		allowedMissingRequiredPaths:
			mode === "edit"
				? Object.entries(schema.fields).flatMap(([key, property]) =>
						retainedSecretPaths(property, values[key], [key], original[key]),
					)
				: [],
	});
	return { parsed, payload };
};

export const schemaFormIssues = (
	schema: AppSchema,
	values: SchemaFormValues,
	mode: SchemaFormMode = "create",
	original: SchemaFormValues = {},
): readonly PropertyValidationIssue[] => {
	const { parsed: result } = schemaFormSubmission(schema, values, mode, original);
	return result.success
		? []
		: result.issues.map((issue) => {
				let property: undefined | AppPropertyDefinition = schema.fields[issue.path[0] ?? ""];
				for (const segment of issue.path.slice(1)) {
					if (property?.type === "array") {
						property = property.items;
					} else if (property?.type === "object") {
						property = property.properties[segment];
					} else {
						property = undefined;
					}
				}
				return issue.message === "is missing" && property !== undefined
					? { path: issue.path, message: `${property.label} is required` }
					: issue;
			});
};

export const validateSchemaFormValues = (
	schema: AppSchema,
	values: SchemaFormValues,
	mode: SchemaFormMode = "create",
	original: SchemaFormValues = {},
): ReadonlyMap<string, string> => {
	const errors = new Map<string, string>();
	for (const issue of schemaFormIssues(schema, values, mode, original)) {
		const key = issue.path[0] ?? "";
		if (!errors.has(key)) {
			errors.set(key, issue.message);
		}
	}
	return errors;
};

export const toSchemaFormPayload = (
	schema: AppSchema,
	values: SchemaFormValues,
	mode: SchemaFormMode = "create",
	original: SchemaFormValues = {},
): Record<string, JsonValue> => {
	const { parsed, payload } = schemaFormSubmission(schema, values, mode, original);
	return parsed.success
		? Object.fromEntries(
				Object.entries(parsed.data).filter((entry): entry is [string, JsonValue] =>
					isJsonValue(entry[1]),
				),
			)
		: payload;
};
