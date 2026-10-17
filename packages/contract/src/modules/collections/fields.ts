import { Result, Schema } from "effect";

import {
	AppSchema,
	type AppPropertyDefinition,
	type AppSchema as AppSchemaType,
} from "../../schema/property-schema";
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

export type KeyedCollectionField = CollectionField & { readonly key: string };

export const reservedCollectionFieldKeys: ReadonlySet<string> = new Set([
	"rank",
	"__proto__",
	"constructor",
	"prototype",
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
): AppSchemaType => ({
	unknownKeys: "strict",
	fields: Object.fromEntries(
		fields.map((field, position) => [
			field.key,
			fieldProperties[field.type](field, fieldBase(field, position)),
		]),
	),
});

const requiredValidation = Schema.optional(
	strictStruct({ required: Schema.optional(Schema.Literal(true)) }),
);

const representableBase = {
	label: Schema.String,
	description: Schema.String,
	validation: requiredValidation,
	position: Schema.optional(Schema.Finite),
};

const representableChoices = strictStruct({
	kind: Schema.Literal("static"),
	values: Schema.Array(strictStruct({ value: Schema.String })),
});

const RepresentableProperty = Schema.Union([
	strictStruct({
		...representableBase,
		type: Schema.Literal("string"),
		defaultValue: Schema.optional(Schema.String),
	}),
	strictStruct({
		...representableBase,
		type: Schema.Literal("number"),
		defaultValue: Schema.optional(Schema.Finite),
	}),
	strictStruct({
		...representableBase,
		type: Schema.Literal("boolean"),
		defaultValue: Schema.optional(Schema.Boolean),
	}),
	strictStruct({
		...representableBase,
		type: Schema.Literals(["date", "datetime"]),
		defaultValue: Schema.optional(Schema.String),
	}),
	strictStruct({
		...representableBase,
		type: Schema.Literal("enum"),
		choices: representableChoices,
		defaultValue: Schema.optional(Schema.String),
	}),
	strictStruct({
		...representableBase,
		choices: representableChoices,
		type: Schema.Literal("enum-array"),
		defaultValue: Schema.optional(Schema.Array(Schema.String)),
	}),
	strictStruct({
		...representableBase,
		type: Schema.Literal("array"),
		defaultValue: Schema.optional(Schema.Array(Schema.String)),
		items: strictStruct({
			type: Schema.Literal("string"),
			label: Schema.Literal(textListItem.label),
			description: Schema.Literal(textListItem.description),
		}),
	}),
]);

type RepresentableProperty = typeof RepresentableProperty.Type;

const RepresentableSchema = strictStruct({
	unknownKeys: Schema.Literal("strict"),
	fields: Schema.Record(Schema.String, RepresentableProperty),
});

const fieldTypes = {
	date: "date",
	enum: "choice",
	string: "text",
	number: "number",
	array: "text-list",
	boolean: "boolean",
	datetime: "datetime",
	"enum-array": "multi-choice",
} as const satisfies Record<RepresentableProperty["type"], CollectionFieldType>;

const toCollectionField = (key: string, property: RepresentableProperty): KeyedCollectionField => ({
	key,
	label: property.label,
	type: fieldTypes[property.type],
	required: property.validation?.required === true,
	...(property.description === property.label ? {} : { description: property.description }),
	...(property.defaultValue === undefined ? {} : { defaultValue: property.defaultValue }),
	...("choices" in property ? { choices: property.choices.values.map(({ value }) => value) } : {}),
});

const declarationOrder = (
	entries: ReadonlyArray<readonly [string, RepresentableProperty]>,
): ReadonlyArray<readonly [string, RepresentableProperty]> =>
	entries
		.map((entry, index) => ({ entry, index }))
		.sort((left, right) => {
			const leftPosition = left.entry[1].position;
			const rightPosition = right.entry[1].position;
			if (leftPosition === undefined && rightPosition === undefined) {
				return left.index - right.index;
			}
			if (leftPosition === undefined) {
				return 1;
			}
			if (rightPosition === undefined) {
				return -1;
			}
			return leftPosition - rightPosition || left.index - right.index;
		})
		.map(({ entry }) => entry);

export const appSchemaToCollectionFields = (
	schema: unknown,
): Result.Result<ReadonlyArray<KeyedCollectionField>, string> => {
	const representable = Schema.decodeUnknownResult(RepresentableSchema)(schema);
	if (Result.isFailure(representable)) {
		return Result.fail("Membership schema uses unsupported collection field shapes");
	}
	if (Result.isFailure(Schema.decodeResult(AppSchema)(representable.success))) {
		return Result.fail("Membership schema is not a valid property schema");
	}
	const entries = Object.entries(representable.success.fields);
	if (entries.some(([key]) => reservedCollectionFieldKeys.has(key))) {
		return Result.fail("Membership schema uses a reserved field key");
	}
	return Result.succeed(
		declarationOrder(entries).map(([key, property]) => toCollectionField(key, property)),
	);
};
