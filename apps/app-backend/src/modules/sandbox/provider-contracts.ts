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

import { withoutSchemaServices } from "#lib/shared/schema";

export const SandboxJsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
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
const NonEmptyTrimmedString: Schema.Schema<string> = Schema.Trim.pipe(
	Schema.check(Schema.isNonEmpty()),
);
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

const ProviderSearchItemSchema: Schema.Schema<ProviderSearchItem> = Schema.Struct({
	titleProperty: TextProperty,
	externalId: NonEmptyTrimmedString,
	imageProperty: Schema.optional(SandboxJsonValueSchema),
	calloutProperty: Schema.optional(SandboxJsonValueSchema),
	secondarySubtitleProperty: Schema.optional(SandboxJsonValueSchema),
	primarySubtitleProperty: Schema.optional(Schema.Union([NullProperty, NumberProperty])),
}).annotate(strict);

const ProviderSearchResultSchema: Schema.Schema<ProviderSearchResult> = Schema.Struct({
	items: Schema.Array(ProviderSearchItemSchema),
	details: Schema.optional(
		Schema.Struct({
			totalItems: Schema.Finite,
			nextPage: Schema.NullOr(Schema.Finite),
		}).annotate(strict),
	),
}).annotate(strict);

const ProviderDetailsRelatedEntitySchema: Schema.Schema<ProviderDetailsRelatedEntity> =
	Schema.Struct({
		name: Schema.String,
		externalId: Schema.String,
		providerSlug: Schema.String,
		relationshipProperties: Schema.optional(SandboxJsonValueSchema),
	}).annotate(strict);

export const ProviderDetailsRelatedEntityGroupSchema: Schema.Schema<ProviderDetailsRelatedEntityGroup> =
	Schema.Struct({
		relationshipSchemaSlug: Schema.String,
		direction: Schema.Literals(["outgoing", "incoming"]),
		synchronization: Schema.Literals(["authoritative", "additive"]),
		entities: Schema.Array(ProviderDetailsRelatedEntitySchema),
	}).annotate(strict);

export const ProviderDetailsChildEntitySchema: Schema.Schema<ProviderDetailsChildEntity> =
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

const ProviderDetailsResultSchema: Schema.Schema<ProviderDetailsResult> = Schema.Struct({
	name: Schema.String,
	properties: SandboxJsonValueSchema,
	expectedChildEntitySchemaSlug: Schema.optional(Schema.String),
	childEntities: Schema.optional(Schema.Array(ProviderDetailsChildEntitySchema)),
	relatedEntityGroups: Schema.optional(Schema.Array(ProviderDetailsRelatedEntityGroupSchema)),
}).annotate(strict);

const ProviderResolveResultSchema: Schema.Schema<ProviderResolveResult> = Schema.Struct({
	externalId: Schema.NullOr(Schema.String),
}).annotate(strict);

const ProviderTranslateResultSchema: Schema.Schema<ProviderTranslateResult> = Schema.Struct({
	name: Schema.optional(Schema.NullOr(Schema.String)),
	properties: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, SandboxJsonValueSchema))),
}).annotate(strict);

export const decodeProviderSearchResult = Schema.decodeUnknownEffect(
	withoutSchemaServices(ProviderSearchResultSchema),
);
export const decodeProviderDetailsResult = Schema.decodeUnknownEffect(
	withoutSchemaServices(ProviderDetailsResultSchema),
);
export const decodeProviderResolveResult = Schema.decodeUnknownEffect(
	withoutSchemaServices(ProviderResolveResultSchema),
);
export const decodeProviderTranslateResult = Schema.decodeUnknownEffect(
	withoutSchemaServices(ProviderTranslateResultSchema),
);
