import { Schema, Effect, SchemaGetter, SchemaTransformation } from "@ryot/sandbox-sdk/effect";

import type { SandboxManifest } from "./core";
import { type GenericScriptDefinition, SANDBOX_SCRIPT_DEFINITION } from "./driver";
import { type JsonValue, jsonValueSchema } from "./wire";

const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });
const trimmedNonEmptyString = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)));
const querySchema = Schema.Unknown.pipe(
	Schema.decodeTo(
		Schema.String,
		SchemaTransformation.transform({
			decode: (value) => (typeof value === "string" ? value.trim() : ""),
			encode: (value) => value,
		}),
	),
);
const integerWithFallback = (fallback: number, maximum?: number) =>
	Schema.Unknown.pipe(
		Schema.decodeTo(
			Schema.Number,
			SchemaTransformation.transform({
				decode: (value) => {
					const coerced = typeof value === "symbol" ? Number.NaN : Number(value);
					return Number.isFinite(coerced) &&
						coerced >= 1 &&
						(maximum === undefined || coerced <= maximum)
						? Math.floor(coerced)
						: fallback;
				},

				encode: (value) => value,
			}),
		),
	);

export type ProviderManifest = Extract<SandboxManifest, { readonly kind: "provider" }>;
export const providerSearchInputSchema = strictStruct({
	query: querySchema.pipe(
		(schema) =>
			Schema.optional(schema).pipe(
				Schema.decodeTo(Schema.toType(schema), {
					decode: SchemaGetter.withDefault(Effect.sync(() => "")),
					encode: SchemaGetter.required(),
				}),
			),
		Schema.withConstructorDefault(Effect.sync(() => "")),
	),
	page: integerWithFallback(1).pipe(
		(schema) =>
			Schema.optional(schema).pipe(
				Schema.decodeTo(Schema.toType(schema), {
					decode: SchemaGetter.withDefault(Effect.sync(() => 1)),
					encode: SchemaGetter.required(),
				}),
			),
		Schema.withConstructorDefault(Effect.sync(() => 1)),
	),
	pageSize: integerWithFallback(20, 100).pipe(
		(schema) =>
			Schema.optional(schema).pipe(
				Schema.decodeTo(Schema.toType(schema), {
					decode: SchemaGetter.withDefault(Effect.sync(() => 20)),
					encode: SchemaGetter.required(),
				}),
			),
		Schema.withConstructorDefault(Effect.sync(() => 20)),
	),
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
	primarySubtitleProperty: Schema.optional(
		Schema.Union([nullPropertySchema, numberPropertySchema]),
	),
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
	providerSlug: Schema.String,
	relationshipProperties: Schema.optional(jsonValueSchema),
});
export const providerDetailsRelatedEntityGroupSchema = strictStruct({
	direction: Schema.Literals(["incoming", "outgoing"]),
	entities: Schema.Array(providerDetailsRelatedEntitySchema),
	synchronization: Schema.Literals(["authoritative", "additive"]),
	relationshipSchemaSlug: Schema.String,
});

export type ProviderDetailsChildEntity = {
	readonly name: string;
	readonly externalId: string;
	readonly properties: JsonValue;
	readonly entitySchemaSlug: string;
	readonly expectedChildEntitySchemaSlug?: string | undefined;
	readonly childEntities?: readonly ProviderDetailsChildEntity[] | undefined;
};
export const providerDetailsChildEntitySchema: Schema.Codec<
	ProviderDetailsChildEntity,
	ProviderDetailsChildEntity
> = Schema.suspend(() =>
	strictStruct({
		name: Schema.String,
		externalId: Schema.String,
		properties: jsonValueSchema,
		entitySchemaSlug: Schema.String,
		expectedChildEntitySchemaSlug: Schema.optional(Schema.String),
		childEntities: Schema.optional(Schema.Array(providerDetailsChildEntitySchema)),
	}),
);
export const providerDetailsResultSchema = strictStruct({
	name: Schema.String,
	properties: jsonValueSchema,
	expectedChildEntitySchemaSlug: Schema.optional(Schema.String),
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
	properties: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, jsonValueSchema))),
});

export const providerOperationContracts = {
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
export type ProviderOperation = keyof typeof providerOperationContracts;
export type ProviderDefinition<
	Manifest extends ProviderManifest,
	Operation extends ProviderOperation,
> = GenericScriptDefinition<
	Manifest,
	(typeof providerOperationContracts)[Operation]["input"],
	(typeof providerOperationContracts)[Operation]["output"]
> & { readonly operation: Operation };
export const defineProvider = <
	const Manifest extends ProviderManifest,
	const Operation extends ProviderOperation,
>(definition: {
	readonly manifest: Manifest;
	readonly operation: Operation;
	readonly run: ProviderDefinition<Manifest, Operation>["run"];
}): ProviderDefinition<Manifest, Operation> =>
	({
		...definition,
		input: providerOperationContracts[definition.operation].input,
		output: providerOperationContracts[definition.operation].output,
		definitionType: SANDBOX_SCRIPT_DEFINITION,
	}) as ProviderDefinition<Manifest, Operation>;
