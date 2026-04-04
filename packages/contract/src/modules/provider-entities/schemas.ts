import { Schema } from "effect";

import { EntitySchemaSlug, SandboxProviderId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { ListedEntity } from "../entities/schemas";
import { jsonValueSchema } from "../sandbox/wire";

export const ProviderEntityReference = strictStruct({
	externalId: Schema.String,
	providerId: SandboxProviderId,
	entitySchemaSlug: EntitySchemaSlug,
});
export type ProviderEntityReference = typeof ProviderEntityReference.Type;

export const ImportEntityBody = strictStruct({
	providerId: SandboxProviderId,
	externalId: Schema.String,
});
export type ImportEntityBody = typeof ImportEntityBody.Type;

export const ImportEntityRunResult = Schema.Union([
	Schema.Struct({ status: Schema.Literal("pending") }).pipe(
		Schema.annotate({
			title: "Pending Import Run Result",
			identifier: "PendingImportEntityRunResult",
		}),
	),
	Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).pipe(
		Schema.annotate({
			title: "Failed Import Run Result",
			identifier: "FailedImportEntityRunResult",
		}),
	),
	Schema.Struct({ status: Schema.Literal("completed"), data: ListedEntity }).pipe(
		Schema.annotate({
			title: "Completed Import Run Result",
			identifier: "CompletedImportEntityRunResult",
		}),
	),
]);
export type ImportEntityRunResult = typeof ImportEntityRunResult.Type;

export const SearchProviderEntitiesBody = strictStruct({
	providerId: SandboxProviderId,
	query: Schema.String,
	page: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(1)),
	),
	pageSize: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
	),
	options: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)),
});
export type SearchProviderEntitiesBody = typeof SearchProviderEntitiesBody.Type;

const ProviderEntitySearchItem = strictStruct({
	externalId: ProviderEntityReference.fields.externalId,
	imageProperty: Schema.optional(jsonValueSchema),
	calloutProperty: Schema.optional(jsonValueSchema),
	secondarySubtitleProperty: Schema.optional(jsonValueSchema),
	titleProperty: strictStruct({ kind: Schema.Literal("text"), value: Schema.String }),
	primarySubtitleProperty: Schema.optional(
		Schema.Union([
			strictStruct({ kind: Schema.Literal("null"), value: Schema.Null }),
			strictStruct({ kind: Schema.Literal("number"), value: Schema.Number }),
		]),
	),
});

export const SearchProviderEntitiesResponse = strictStruct({
	providerName: Schema.String,
	items: Schema.Array(ProviderEntitySearchItem),
	providerId: ProviderEntityReference.fields.providerId,
	rootEntitySchemaSlug: ProviderEntityReference.fields.entitySchemaSlug,
	details: Schema.optional(
		strictStruct({ totalItems: Schema.Number, nextPage: Schema.NullOr(Schema.Number) }),
	),
});
export type SearchProviderEntitiesResponse = typeof SearchProviderEntitiesResponse.Type;
