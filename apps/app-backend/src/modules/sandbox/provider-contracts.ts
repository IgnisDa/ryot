import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import { providerSearchOptionsResultSchema } from "@ryot/sandbox-sdk/provider";
import type {
	ProviderDetailsChildEntity,
	ProviderDetailsRelatedEntity,
	ProviderDetailsRelatedEntityGroup,
	ProviderDetailsResult,
	ProviderResolveResult,
	ProviderSearchResultItem,
	ProviderSearchOptionsResult,
	ProviderSearchResult,
	ProviderTranslateResult,
} from "@ryot/sandbox-sdk/provider";
import { Schema } from "effect";

export const SandboxJsonValueSchema: Schema.Codec<JsonValue> = Schema.suspend(() =>
	Schema.Union([
		Schema.Null,
		Schema.String,
		Schema.Finite,
		Schema.Boolean,
		Schema.Array(SandboxJsonValueSchema),
		Schema.Record(Schema.String, SandboxJsonValueSchema),
	]),
).annotate({ identifier: "SandboxJsonValue" });

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const NonEmptyTrimmedString = Schema.Trim.pipe(
	Schema.check(Schema.isNonEmpty()),
) satisfies Schema.Codec<string>;
const ProviderSearchResultMetadataValueSchema = Schema.Union([
	Schema.Finite,
	NonEmptyTrimmedString,
]);
const ProviderSearchResultItemSchema = Schema.Struct({
	title: NonEmptyTrimmedString,
	externalId: NonEmptyTrimmedString,
	imageUrl: Schema.optional(NonEmptyTrimmedString),
	metadata: Schema.optional(Schema.NonEmptyArray(ProviderSearchResultMetadataValueSchema)),
}).annotate(strict) satisfies Schema.Codec<ProviderSearchResultItem>;

const ProviderSearchResultSchema = Schema.Struct({
	items: Schema.Array(ProviderSearchResultItemSchema),
	details: Schema.optional(
		Schema.Struct({ totalItems: Schema.Finite, nextPage: Schema.NullOr(Schema.Finite) }).annotate(
			strict,
		),
	),
}).annotate(strict) satisfies Schema.Codec<ProviderSearchResult>;

export const ProviderSearchOptionsResultSchema =
	providerSearchOptionsResultSchema satisfies Schema.Codec<ProviderSearchOptionsResult>;

const ProviderDetailsRelatedEntitySchema = Schema.Struct({
	name: Schema.String,
	externalId: Schema.String,
	providerSlug: Schema.String,
	relationshipProperties: Schema.optional(SandboxJsonValueSchema),
}).annotate(strict) satisfies Schema.Codec<ProviderDetailsRelatedEntity>;

export const ProviderDetailsRelatedEntityGroupSchema: Schema.Codec<ProviderDetailsRelatedEntityGroup> =
	Schema.Struct({
		relationshipSchemaSlug: Schema.String,
		direction: Schema.Literals(["outgoing", "incoming"]),
		entities: Schema.Array(ProviderDetailsRelatedEntitySchema),
		synchronization: Schema.Literals(["authoritative", "additive"]),
	}).annotate(strict);

export const ProviderDetailsChildEntitySchema: Schema.Codec<ProviderDetailsChildEntity> =
	Schema.suspend(() =>
		Schema.Struct({
			name: Schema.String,
			externalId: Schema.String,
			entitySchemaSlug: Schema.String,
			properties: SandboxJsonValueSchema,
			expectedChildEntitySchemaSlug: Schema.optional(Schema.String),
			childEntities: Schema.optional(Schema.Array(ProviderDetailsChildEntitySchema)),
		}).annotate(strict),
	).annotate({ identifier: "ProviderDetailsChildEntity" });

const ProviderDetailsResultSchema = Schema.Struct({
	name: Schema.String,
	properties: SandboxJsonValueSchema,
	expectedChildEntitySchemaSlug: Schema.optional(Schema.String),
	childEntities: Schema.optional(Schema.Array(ProviderDetailsChildEntitySchema)),
	relatedEntityGroups: Schema.optional(Schema.Array(ProviderDetailsRelatedEntityGroupSchema)),
}).annotate(strict) satisfies Schema.Codec<ProviderDetailsResult>;

const ProviderResolveResultSchema = Schema.Struct({
	externalId: Schema.NullOr(Schema.String),
}).annotate(strict) satisfies Schema.Codec<ProviderResolveResult>;

const ProviderTranslateResultSchema = Schema.Struct({
	name: Schema.optional(Schema.NullOr(Schema.String)),
	properties: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, SandboxJsonValueSchema))),
}).annotate(strict) satisfies Schema.Codec<ProviderTranslateResult>;

export const decodeProviderSearchResult = Schema.decodeUnknownEffect(ProviderSearchResultSchema);
export const decodeProviderSearchOptionsResult = Schema.decodeUnknownEffect(
	ProviderSearchOptionsResultSchema,
);
export const decodeProviderDetailsResult = Schema.decodeUnknownEffect(ProviderDetailsResultSchema);
export const decodeProviderResolveResult = Schema.decodeUnknownEffect(ProviderResolveResultSchema);
export const decodeProviderTranslateResult = Schema.decodeUnknownEffect(
	ProviderTranslateResultSchema,
);
