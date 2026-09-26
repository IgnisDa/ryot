import { Schema } from "effect";

import { EntitySchemaSlug, SandboxProviderId } from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";
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
	externalId: Schema.String,
	providerId: SandboxProviderId,
});
export type ImportEntityBody = typeof ImportEntityBody.Type;

export const ImportEntityRunResult = Schema.Union([
	Schema.Struct({ status: Schema.Literal("queued") }).pipe(
		Schema.annotate({
			title: "Queued Import Run Result",
			identifier: "QueuedImportEntityRunResult",
		}),
	),
	Schema.Struct({ status: Schema.Literal("running") }).pipe(
		Schema.annotate({
			title: "Running Import Run Result",
			identifier: "RunningImportEntityRunResult",
		}),
	),
	Schema.Struct({ status: Schema.Literal("cancelled") }).pipe(
		Schema.annotate({
			title: "Cancelled Import Run Result",
			identifier: "CancelledImportEntityRunResult",
		}),
	),
	Schema.Struct({
		status: Schema.Literal("failed"),
		reason: Schema.Struct({
			code: Schema.Literal("import-failed"),
			stage: Schema.Literals(["population", "provider-import-automation", "unexpected"]),
		}),
	}).pipe(
		Schema.annotate({
			title: "Failed Import Run Result",
			identifier: "FailedImportEntityRunResult",
		}),
	),
	Schema.Struct({ data: ListedEntity, status: Schema.Literal("completed") }).pipe(
		Schema.annotate({
			title: "Completed Import Run Result",
			identifier: "CompletedImportEntityRunResult",
		}),
	),
]);
export type ImportEntityRunResult = typeof ImportEntityRunResult.Type;

export const SearchProviderEntitiesBody = strictStruct({
	query: Schema.String,
	providerId: SandboxProviderId,
	options: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)),
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

export const SearchProviderOptionsBody = strictStruct({ providerId: SandboxProviderId });
export type SearchProviderOptionsBody = typeof SearchProviderOptionsBody.Type;

export const SearchProviderOptionsResponse = strictStruct({ schema: Schema.NullOr(AppSchema) });
export type SearchProviderOptionsResponse = typeof SearchProviderOptionsResponse.Type;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)));
const providerSearchResultMetadataValueSchema = Schema.Union([
	Schema.Finite,
	trimmedNonEmptyString,
]);
export const ProviderSearchResultItem = strictStruct({
	title: trimmedNonEmptyString,
	imageUrl: Schema.optional(trimmedNonEmptyString),
	externalId: ProviderEntityReference.fields.externalId,
	metadata: Schema.optional(Schema.NonEmptyArray(providerSearchResultMetadataValueSchema)),
});
export type ProviderSearchResultItem = typeof ProviderSearchResultItem.Type;

export const SearchProviderEntitiesResponse = strictStruct({
	providerName: Schema.String,
	items: Schema.Array(ProviderSearchResultItem),
	providerId: ProviderEntityReference.fields.providerId,
	rootEntitySchemaSlug: ProviderEntityReference.fields.entitySchemaSlug,
	details: Schema.optional(
		strictStruct({ totalItems: Schema.Number, nextPage: Schema.NullOr(Schema.Number) }),
	),
});
export type SearchProviderEntitiesResponse = typeof SearchProviderEntitiesResponse.Type;

const ProviderEntityBadRequestReason = Schema.Union([
	strictStruct({ code: Schema.Literal("search-failed") }),
	strictStruct({ code: Schema.Literal("invalid-search-result") }),
	strictStruct({ code: Schema.Literal("invalid-search-options") }),
	strictStruct({ code: Schema.Literal("search-options-unavailable") }),
	strictStruct({ providerId: SandboxProviderId, code: Schema.Literal("search-unsupported") }),
	strictStruct({
		code: Schema.Literal("invalid-import-input"),
		field: Schema.Literals(["providerId", "externalId"]),
	}),
	strictStruct({
		providerId: SandboxProviderId,
		code: Schema.Literal("search-options-unsupported"),
	}),
]);

const ProviderEntityNotFoundReason = Schema.Union([
	strictStruct({ jobId: Schema.String, code: Schema.Literal("import-job-not-found") }),
	strictStruct({ providerId: SandboxProviderId, code: Schema.Literal("provider-not-found") }),
	strictStruct({
		entitySchemaSlug: EntitySchemaSlug,
		code: Schema.Literal("entity-schema-not-found"),
	}),
]);

export class ProviderEntityBadRequest extends Schema.TaggedError<ProviderEntityBadRequest>()(
	"ProviderEntityBadRequest",
	{ reason: ProviderEntityBadRequestReason },
) {}

export class ProviderEntityNotFound extends Schema.TaggedError<ProviderEntityNotFound>()(
	"ProviderEntityNotFound",
	{ reason: ProviderEntityNotFoundReason },
) {}

export class ProviderEntityImportBacklogFull extends Schema.TaggedError<ProviderEntityImportBacklogFull>()(
	"ProviderEntityImportBacklogFull",
	{
		reason: strictStruct({
			limit: Schema.Int,
			retryAfterSeconds: Schema.Int,
			code: Schema.Literal("import-backlog-full"),
		}),
	},
) {}

export class ProviderEntityInternalError extends Schema.TaggedError<ProviderEntityInternalError>()(
	"ProviderEntityInternalError",
	{ reason: strictStruct({ code: Schema.Literal("unexpected-error") }) },
) {}
