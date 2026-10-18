import { Result, Schema } from "effect";

import type { AppPropertyDefinition, AppSchema } from "../../schema/property-schema";
import { parseAppSchemaPropertiesSafe } from "../../schema/property-values";
import { strictStruct } from "../../schema/utils";

export const CollectionFieldType = Schema.Literals([
	"text",
	"number",
	"boolean",
	"date",
	"datetime",
	"choice",
	"multi-choice",
	"text-list",
]);

export type CollectionFieldType = typeof CollectionFieldType.Type;

export const collectionFieldLimits = {
	fields: 50,
	choices: 100,
	labelLength: 100,
	choiceLength: 100,
	descriptionLength: 500,
} as const;

const choiceFieldTypes: ReadonlySet<CollectionFieldType> = new Set(["choice", "multi-choice"]);

export const hasCollectionFieldChoices = (type: CollectionFieldType) => choiceFieldTypes.has(type);

export const CollectionField = strictStruct({
	label: Schema.String,
	required: Schema.Boolean,
	type: CollectionFieldType,
	key: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
	choices: Schema.optional(Schema.Array(Schema.String)),
	defaultValue: Schema.optional(
		Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Array(Schema.String)]),
	),
});

export type CollectionField = typeof CollectionField.Type;

export const KeyedCollectionField = strictStruct({ ...CollectionField.fields, key: Schema.String });
export type KeyedCollectionField = typeof KeyedCollectionField.Type;

export const reservedCollectionFieldKeys: ReadonlySet<string> = new Set([
	"rank",
	"__proto__",
	"prototype",
	"constructor",
]);

const textListItem = { label: "Item", type: "string", description: "Item" } as const;

const stringDefault = (value: CollectionField["defaultValue"]) =>
	typeof value === "string" ? { defaultValue: value } : {};

const stringArrayDefault = (value: CollectionField["defaultValue"]) =>
	Array.isArray(value) ? { defaultValue: value } : {};

const staticChoices = (choices: CollectionField["choices"]) => ({
	kind: "static" as const,
	values: (choices ?? []).map((value) => ({ value })),
});

const fieldBase = (field: KeyedCollectionField, position: number) => ({
	position,
	label: field.label,
	description: field.description?.trim() ? field.description : field.label,
	...(field.required ? { validation: { required: true as const } } : {}),
});

const fieldProperties: Record<
	CollectionFieldType,
	(field: KeyedCollectionField, base: ReturnType<typeof fieldBase>) => AppPropertyDefinition
> = {
	date: (field, base) => ({ ...base, type: "date", ...stringDefault(field.defaultValue) }),
	text: (field, base) => ({ ...base, type: "string", ...stringDefault(field.defaultValue) }),
	datetime: (field, base) => ({ ...base, type: "datetime", ...stringDefault(field.defaultValue) }),
	"text-list": (field, base) => ({
		...base,
		type: "array",
		items: textListItem,
		...stringArrayDefault(field.defaultValue),
	}),
	choice: (field, base) => ({
		...base,
		type: "enum",
		choices: staticChoices(field.choices),
		...stringDefault(field.defaultValue),
	}),
	number: (field, base) => ({
		...base,
		type: "number",
		...(typeof field.defaultValue === "number" ? { defaultValue: field.defaultValue } : {}),
	}),
	boolean: (field, base) => ({
		...base,
		type: "boolean",
		...(typeof field.defaultValue === "boolean" ? { defaultValue: field.defaultValue } : {}),
	}),
	"multi-choice": (field, base) => ({
		...base,
		type: "enum-array",
		choices: staticChoices(field.choices),
		...stringArrayDefault(field.defaultValue),
	}),
};

export const collectionFieldsToAppSchema = (
	fields: ReadonlyArray<KeyedCollectionField>,
): AppSchema => ({
	unknownKeys: "strict",
	fields: Object.fromEntries(
		fields.map((field, position) => [
			field.key,
			fieldProperties[field.type](field, fieldBase(field, position)),
		]),
	),
});

export const normalizeCollectionField = (field: CollectionField): CollectionField => {
	const description = field.description?.trim();
	return {
		type: field.type,
		required: field.required,
		label: field.label.trim(),
		...(field.key === undefined ? {} : { key: field.key }),
		...(description ? { description } : {}),
		...(field.choices === undefined
			? {}
			: { choices: field.choices.map((choice) => choice.trim()) }),
		...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
	};
};

const collectionFieldIssues = (field: CollectionField, index: number) => {
	const path = (...segments: ReadonlyArray<string>) => ["fields", String(index), ...segments];
	const issues: Array<ReadonlyArray<string>> = [];
	if (field.label === "" || field.label.length > collectionFieldLimits.labelLength) {
		issues.push(path("label"));
	}
	if ((field.description?.length ?? 0) > collectionFieldLimits.descriptionLength) {
		issues.push(path("description"));
	}
	const choices = field.choices;
	if (hasCollectionFieldChoices(field.type)) {
		if (
			!choices ||
			choices.length === 0 ||
			choices.length > collectionFieldLimits.choices ||
			new Set(choices).size !== choices.length
		) {
			issues.push(path("choices"));
		}
		for (const [choiceIndex, choice] of (choices ?? []).entries()) {
			if (choice === "" || choice.length > collectionFieldLimits.choiceLength) {
				issues.push(path("choices", String(choiceIndex)));
			}
		}
	} else if (choices !== undefined) {
		issues.push(path("choices"));
	}
	return issues;
};

const collectionFieldDefaultIssues = (field: KeyedCollectionField, index: number) => {
	if (field.defaultValue === undefined) {
		return [];
	}
	const parsed = parseAppSchemaPropertiesSafe({
		properties: { [field.key]: field.defaultValue },
		propertiesSchema: collectionFieldsToAppSchema([field]),
	});
	return parsed.success ? [] : [["fields", String(index), "defaultValue"]];
};

export const keyedCollectionFieldIssues = (
	fields: ReadonlyArray<KeyedCollectionField>,
	isAcceptedKey: (key: string) => boolean = () => true,
) => {
	const issues: Array<ReadonlyArray<string>> =
		fields.length > collectionFieldLimits.fields ? [["fields"]] : [];
	const keys = new Set<string>();
	for (const [index, field] of fields.entries()) {
		issues.push(...collectionFieldIssues(field, index));
		if (
			field.key.trim() === "" ||
			keys.has(field.key) ||
			reservedCollectionFieldKeys.has(field.key) ||
			!isAcceptedKey(field.key)
		) {
			issues.push(["fields", String(index), "key"]);
		}
		keys.add(field.key);
	}
	if (issues.length === 0) {
		issues.push(...fields.flatMap(collectionFieldDefaultIssues));
	}
	return issues;
};

const isNormalizedCollectionField = (field: KeyedCollectionField) => {
	const normalized = normalizeCollectionField(field);
	return (
		normalized.label === field.label &&
		normalized.description === field.description &&
		(normalized.choices ?? []).every((choice, index) => choice === field.choices?.[index])
	);
};

export const decodeCollectionFields = (
	input: unknown,
): Result.Result<ReadonlyArray<KeyedCollectionField>, string> => {
	const decoded = Schema.decodeUnknownResult(Schema.Array(KeyedCollectionField))(
		input === undefined ? [] : input,
	);
	if (Result.isFailure(decoded)) {
		return Result.fail("Invalid collection field declarations");
	}
	const fields = decoded.success;
	if (!fields.every(isNormalizedCollectionField) || keyedCollectionFieldIssues(fields).length > 0) {
		return Result.fail("Invalid collection field declaration");
	}
	return Result.succeed(fields);
};
