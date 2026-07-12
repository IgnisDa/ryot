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
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { Schema } from "effect";

export const SandboxJsonValueSchema: Schema.Schema<JsonValue, JsonValue> = Schema.suspend(() =>
	Schema.Union(
		Schema.Null,
		Schema.String,
		Schema.Number,
		Schema.Boolean,
		Schema.Array(SandboxJsonValueSchema),
		Schema.Record({ key: Schema.String, value: SandboxJsonValueSchema }),
	),
).annotations({ identifier: "SandboxJsonValue" });

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const NonEmptyTrimmedString: Schema.Schema<string, string> = Schema.Trim.pipe(
	Schema.nonEmptyString(),
);
const NullProperty = Schema.Struct({
	value: Schema.Null,
	kind: Schema.Literal("null"),
}).annotations(strict);
const NumberProperty = Schema.Struct({
	value: Schema.Number,
	kind: Schema.Literal("number"),
}).annotations(strict);
const TextProperty = Schema.Struct({
	kind: Schema.Literal("text"),
	value: NonEmptyTrimmedString,
}).annotations(strict);

const ProviderSearchItemSchema: Schema.Schema<ProviderSearchItem, ProviderSearchItem> =
	Schema.Struct({
		titleProperty: TextProperty,
		externalId: NonEmptyTrimmedString,
		imageProperty: Schema.optional(SandboxJsonValueSchema),
		calloutProperty: Schema.optional(SandboxJsonValueSchema),
		secondarySubtitleProperty: Schema.optional(SandboxJsonValueSchema),
		primarySubtitleProperty: Schema.optional(Schema.Union(NullProperty, NumberProperty)),
	}).annotations(strict);

const ProviderSearchResultSchema: Schema.Schema<ProviderSearchResult, ProviderSearchResult> =
	Schema.Struct({
		items: Schema.Array(ProviderSearchItemSchema),
		details: Schema.optional(
			Schema.Struct({
				totalItems: Schema.Number,
				nextPage: Schema.NullOr(Schema.Number),
			}).annotations(strict),
		),
	}).annotations(strict);

const ProviderDetailsRelatedEntitySchema: Schema.Schema<
	ProviderDetailsRelatedEntity,
	ProviderDetailsRelatedEntity
> = Schema.Struct({
	name: Schema.String,
	externalId: Schema.String,
	providerSlug: Schema.String,
	relationshipProperties: Schema.optional(SandboxJsonValueSchema),
}).annotations(strict);

export const ProviderDetailsRelatedEntityGroupSchema: Schema.Schema<
	ProviderDetailsRelatedEntityGroup,
	ProviderDetailsRelatedEntityGroup
> = Schema.Struct({
	relationshipSchemaSlug: Schema.String,
	direction: Schema.Literal("outgoing", "incoming"),
	synchronization: Schema.Literal("authoritative", "additive"),
	entities: Schema.Array(ProviderDetailsRelatedEntitySchema),
}).annotations(strict);

export const ProviderDetailsChildEntitySchema: Schema.Schema<
	ProviderDetailsChildEntity,
	ProviderDetailsChildEntity
> = Schema.suspend(() =>
	Schema.Struct({
		name: Schema.String,
		externalId: Schema.String,
		properties: SandboxJsonValueSchema,
		entitySchemaSlug: Schema.String,
		expectedChildEntitySchemaSlug: Schema.optional(Schema.String),
		childEntities: Schema.optional(Schema.Array(ProviderDetailsChildEntitySchema)),
	}).annotations(strict),
).annotations({ identifier: "ProviderDetailsChildEntity" });

const ProviderDetailsResultSchema: Schema.Schema<ProviderDetailsResult, ProviderDetailsResult> =
	Schema.Struct({
		name: Schema.String,
		properties: SandboxJsonValueSchema,
		expectedChildEntitySchemaSlug: Schema.optional(Schema.String),
		childEntities: Schema.optional(Schema.Array(ProviderDetailsChildEntitySchema)),
		relatedEntityGroups: Schema.optional(Schema.Array(ProviderDetailsRelatedEntityGroupSchema)),
	}).annotations(strict);

const ProviderResolveResultSchema: Schema.Schema<ProviderResolveResult, ProviderResolveResult> =
	Schema.Struct({ externalId: Schema.NullOr(Schema.String) }).annotations(strict);

const ProviderTranslateResultSchema: Schema.Schema<
	ProviderTranslateResult,
	ProviderTranslateResult
> = Schema.Struct({
	name: Schema.optional(Schema.NullOr(Schema.String)),
	properties: Schema.optional(
		Schema.NullOr(Schema.Record({ key: Schema.String, value: SandboxJsonValueSchema })),
	),
}).annotations(strict);

export const decodeProviderSearchResult = Schema.decodeUnknown(ProviderSearchResultSchema);
export const decodeProviderDetailsResult = Schema.decodeUnknown(ProviderDetailsResultSchema);
export const decodeProviderResolveResult = Schema.decodeUnknown(ProviderResolveResultSchema);
export const decodeProviderTranslateResult = Schema.decodeUnknown(ProviderTranslateResultSchema);
