import { Schema } from "@ryot/sandbox-sdk/effect";

import {
	jsonValueSchema,
	SANDBOX_SCRIPT_DEFINITION,
	type GenericDriver,
	type GenericScriptDefinition,
	type JsonValue,
	type SandboxManifest,
} from "./core.js";

const strictStruct = <Fields extends Record<string, Schema.Struct.Field>>(fields: Fields) =>
	Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "error" as const } });
const trimmedNonEmptyString = Schema.Trim.pipe(Schema.minLength(1));
const querySchema = Schema.transform(Schema.Unknown, Schema.String, {
	strict: true,
	encode: (value) => value,
	decode: (value) => (typeof value === "string" ? value.trim() : ""),
});
const integerWithFallback = (fallback: number, maximum?: number) =>
	Schema.transform(Schema.Unknown, Schema.Number, {
		strict: true,
		encode: (value) => value,
		decode: (value) => {
			const coerced = typeof value === "symbol" ? Number.NaN : Number(value);
			return Number.isFinite(coerced) &&
				coerced >= 1 &&
				(maximum === undefined || coerced <= maximum)
				? Math.floor(coerced)
				: fallback;
		},
	});

export type ProviderManifest = Extract<SandboxManifest, { readonly kind: "provider" }>;
export const providerSearchInputSchema = strictStruct({
	query: Schema.optionalWith(querySchema, { default: () => "" }),
	page: Schema.optionalWith(integerWithFallback(1), { default: () => 1 }),
	pageSize: Schema.optionalWith(integerWithFallback(20, 100), { default: () => 20 }),
});

const nullPropertySchema = strictStruct({ kind: Schema.Literal("null"), value: Schema.Null });
const numberPropertySchema = strictStruct({ kind: Schema.Literal("number"), value: Schema.Number });
const textPropertySchema = strictStruct({
	kind: Schema.Literal("text"),
	value: trimmedNonEmptyString,
});
export const providerSearchItemSchema = strictStruct({
	externalId: trimmedNonEmptyString,
	titleProperty: textPropertySchema,
	imageProperty: Schema.optional(jsonValueSchema),
	calloutProperty: Schema.optional(jsonValueSchema),
	secondarySubtitleProperty: Schema.optional(jsonValueSchema),
	primarySubtitleProperty: Schema.optional(Schema.Union(nullPropertySchema, numberPropertySchema)),
});
export const providerSearchResultSchema = strictStruct({
	items: Schema.Array(providerSearchItemSchema),
	details: Schema.optional(
		strictStruct({ totalItems: Schema.Number, nextPage: Schema.NullOr(Schema.Number) }),
	),
});
export const providerDetailsInputSchema = strictStruct({ externalId: trimmedNonEmptyString });
export const providerDetailsRelatedEntitySchema = strictStruct({
	name: Schema.String,
	externalId: Schema.String,
	scriptSlug: Schema.String,
	relationshipProperties: Schema.optional(jsonValueSchema),
});
export const providerDetailsRelatedEntityGroupSchema = strictStruct({
	direction: Schema.Literal("incoming", "outgoing"),
	entities: Schema.Array(providerDetailsRelatedEntitySchema),
	synchronization: Schema.Literal("authoritative", "additive"),
	relationshipSchemaSlug: Schema.String,
});

export type ProviderDetailsChildEntity = {
	readonly name: string;
	readonly externalId: string;
	readonly properties: JsonValue;
	readonly entitySchemaSlug: string;
	readonly childEntities?: readonly ProviderDetailsChildEntity[] | undefined;
};
export const providerDetailsChildEntitySchema: Schema.Schema<ProviderDetailsChildEntity> =
	Schema.suspend(() =>
		strictStruct({
			name: Schema.String,
			externalId: Schema.String,
			properties: jsonValueSchema,
			entitySchemaSlug: Schema.String,
			childEntities: Schema.optional(Schema.Array(providerDetailsChildEntitySchema)),
		}),
	);
export const providerDetailsResultSchema = strictStruct({
	name: Schema.String,
	properties: jsonValueSchema,
	childEntities: Schema.optional(Schema.Array(providerDetailsChildEntitySchema)),
	relatedEntityGroups: Schema.optional(Schema.Array(providerDetailsRelatedEntityGroupSchema)),
});
export const providerResolveInputSchema = strictStruct({
	value: trimmedNonEmptyString,
	identifierType: trimmedNonEmptyString,
});
export const providerResolveResultSchema = strictStruct({
	externalId: Schema.NullOr(Schema.String),
});
export const providerTranslateInputSchema = strictStruct({
	language: trimmedNonEmptyString,
	externalId: trimmedNonEmptyString,
	entitySchemaSlug: trimmedNonEmptyString,
	properties: Schema.optional(jsonValueSchema),
});
export const providerTranslateResultSchema = strictStruct({
	name: Schema.optional(Schema.NullOr(Schema.String)),
	properties: Schema.optional(
		Schema.NullOr(Schema.Record({ key: Schema.String, value: jsonValueSchema })),
	),
});

export const providerDriverContracts = {
	search: { input: providerSearchInputSchema, output: providerSearchResultSchema },
	details: { input: providerDetailsInputSchema, output: providerDetailsResultSchema },
	resolve: { input: providerResolveInputSchema, output: providerResolveResultSchema },
	translate: { input: providerTranslateInputSchema, output: providerTranslateResultSchema },
} as const;

export type ProviderSearchItem = Schema.Schema.Type<typeof providerSearchItemSchema>;
export type ProviderSearchInput = Schema.Schema.Type<typeof providerSearchInputSchema>;
export type ProviderSearchResult = Schema.Schema.Type<typeof providerSearchResultSchema>;
export type ProviderDetailsInput = Schema.Schema.Type<typeof providerDetailsInputSchema>;
export type ProviderDetailsResult = Schema.Schema.Type<typeof providerDetailsResultSchema>;
export type ProviderResolveInput = Schema.Schema.Type<typeof providerResolveInputSchema>;
export type ProviderResolveResult = Schema.Schema.Type<typeof providerResolveResultSchema>;
export type ProviderTranslateInput = Schema.Schema.Type<typeof providerTranslateInputSchema>;
export type ProviderTranslateResult = Schema.Schema.Type<typeof providerTranslateResultSchema>;
export type ProviderDetailsRelatedEntity = Schema.Schema.Type<
	typeof providerDetailsRelatedEntitySchema
>;
export type ProviderDetailsRelatedEntityGroup = Schema.Schema.Type<
	typeof providerDetailsRelatedEntityGroupSchema
>;
export type ProviderDriverName = keyof typeof providerDriverContracts;
export type ProviderDriver<
	Manifest extends ProviderManifest,
	Name extends ProviderDriverName,
> = GenericDriver<
	(typeof providerDriverContracts)[Name]["input"],
	(typeof providerDriverContracts)[Name]["output"],
	Manifest["capabilities"]
>;

export const defineProviderDriver = <
	const Manifest extends ProviderManifest,
	const Name extends ProviderDriverName,
>(
	_manifest: Manifest,
	name: Name,
	run: ProviderDriver<Manifest, Name>["run"],
): ProviderDriver<Manifest, Name> => ({
	run,
	input: providerDriverContracts[name].input,
	output: providerDriverContracts[name].output,
});

type StandardProviderDrivers<Manifest extends ProviderManifest> = {
	readonly [Name in ProviderDriverName]: ProviderDriver<Manifest, Name>;
};
export type ProviderDefinition<
	Manifest extends ProviderManifest,
	Drivers extends Partial<StandardProviderDrivers<Manifest>> & Record<string, unknown>,
> = GenericScriptDefinition<Manifest, Drivers>;
export const defineProvider = <
	const Manifest extends ProviderManifest,
	const Drivers extends Partial<StandardProviderDrivers<Manifest>> & Record<string, unknown>,
>(definition: {
	readonly manifest: Manifest;
	readonly drivers: Drivers;
}): ProviderDefinition<Manifest, Drivers> => ({
	...definition,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
