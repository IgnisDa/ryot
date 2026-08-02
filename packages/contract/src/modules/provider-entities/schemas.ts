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

export const ImportEntityBody = Schema.Struct({
	...ProviderEntityReference.fields,
});

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

export const SearchProviderEntitiesBody = strictStruct({
	savedViewSlug: Schema.String,
	query: Schema.String,
	page: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(1)),
	),
	pageSize: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
	),
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

const ProviderEntitySearchProviderFields = {
	providerName: Schema.String,
	providerId: ProviderEntityReference.fields.providerId,
	entitySchemaSlug: ProviderEntityReference.fields.entitySchemaSlug,
};

const ProviderEntitySearchProviderResult = Schema.Union([
	strictStruct({
		...ProviderEntitySearchProviderFields,
		status: Schema.Literal("success"),
		items: Schema.Array(ProviderEntitySearchItem),
		details: Schema.optional(
			strictStruct({ totalItems: Schema.Number, nextPage: Schema.NullOr(Schema.Number) }),
		),
	}),
	strictStruct({
		...ProviderEntitySearchProviderFields,
		status: Schema.Literal("failure"),
		error: Schema.String,
	}),
]);

export const SearchProviderEntitiesResponse = strictStruct({
	providers: Schema.Array(ProviderEntitySearchProviderResult),
});
export type SearchProviderEntitiesResponse = typeof SearchProviderEntitiesResponse.Type;
