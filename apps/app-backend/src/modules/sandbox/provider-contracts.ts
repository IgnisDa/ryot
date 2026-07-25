import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import type {
	ProviderDetailsChildEntity,
	ProviderDetailsRelatedEntity,
	ProviderDetailsRelatedEntityGroup,
	ProviderDetailsResult,
	ProviderResolveResult,
	ProviderSearchItem,
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
const NullProperty = Schema.Struct({
	value: Schema.Null,
	kind: Schema.Literal("null"),
}).annotate(strict);
const NumberProperty = Schema.Struct({
	value: Schema.Finite,
	kind: Schema.Literal("number"),
}).annotate(strict);
const TextProperty = Schema.Struct({
	kind: Schema.Literal("text"),
	value: NonEmptyTrimmedString,
}).annotate(strict);

const ProviderSearchItemSchema = Schema.Struct({
	titleProperty: TextProperty,
	externalId: NonEmptyTrimmedString,
	imageProperty: Schema.optional(SandboxJsonValueSchema),
	calloutProperty: Schema.optional(SandboxJsonValueSchema),
	secondarySubtitleProperty: Schema.optional(SandboxJsonValueSchema),
	primarySubtitleProperty: Schema.optional(Schema.Union([NullProperty, NumberProperty])),
}).annotate(strict) satisfies Schema.Codec<ProviderSearchItem>;

const ProviderSearchResultSchema = Schema.Struct({
	items: Schema.Array(ProviderSearchItemSchema),
	details: Schema.optional(
		Schema.Struct({
			totalItems: Schema.Finite,
			nextPage: Schema.NullOr(Schema.Finite),
		}).annotate(strict),
	),
}).annotate(strict) satisfies Schema.Codec<ProviderSearchResult>;

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
		synchronization: Schema.Literals(["authoritative", "additive"]),
		entities: Schema.Array(ProviderDetailsRelatedEntitySchema),
	}).annotate(strict);

export const ProviderDetailsChildEntitySchema: Schema.Codec<ProviderDetailsChildEntity> =
	Schema.suspend(() =>
		Schema.Struct({
			name: Schema.String,
			externalId: Schema.String,
			properties: SandboxJsonValueSchema,
			entitySchemaSlug: Schema.String,
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
export const decodeProviderDetailsResult = Schema.decodeUnknownEffect(ProviderDetailsResultSchema);
export const decodeProviderResolveResult = Schema.decodeUnknownEffect(ProviderResolveResultSchema);
export const decodeProviderTranslateResult = Schema.decodeUnknownEffect(
	ProviderTranslateResultSchema,
);
