import type { JsonValue } from "@ryot/sandbox-sdk";
import { Schema } from "effect";

import { ImportRunId, IntegrationId, RelationshipSchemaId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";

const JsonValueSchema: Schema.Schema<JsonValue, JsonValue> = Schema.suspend(() =>
	Schema.Union(
		Schema.Null,
		Schema.String,
		Schema.Boolean,
		Schema.Array(JsonValueSchema),
		Schema.Record({ key: Schema.String, value: JsonValueSchema }),
		Schema.Number.pipe(
			Schema.filter(Number.isFinite, { message: () => "JSON numbers must be finite" }),
		),
	),
);

export const AutomationRuleKind = Schema.Literal("policy", "subscription");

export type AutomationRuleKind = typeof AutomationRuleKind.Type;

export const AutomationOperation = Schema.Literal("create", "update", "delete", "signal");

export type AutomationOperation = typeof AutomationOperation.Type;

export const AutomationRuleMetadata = JsonValueSchema;

export type AutomationRuleMetadata = typeof AutomationRuleMetadata.Type;

export const SubscriptionRunSourceKind = Schema.Literal(
	"entity",
	"event",
	"relationship",
	"signal",
);

export type SubscriptionRunSourceKind = typeof SubscriptionRunSourceKind.Type;

export const SubscriptionRunStatus = Schema.Literal(
	"queued",
	"running",
	"succeeded",
	"failed",
	"skipped",
);

export type SubscriptionRunStatus = typeof SubscriptionRunStatus.Type;

export const SubscriptionRunTiming = strictStruct({
	totalMs: Schema.Number,
	executionMs: Schema.Number,
});

export type SubscriptionRunTiming = typeof SubscriptionRunTiming.Type;

export const SubscriptionRunSkipReason = Schema.Union(
	strictStruct({ kind: Schema.Literal("user_disabled") }),
);

export type SubscriptionRunSkipReason = typeof SubscriptionRunSkipReason.Type;

export const SignalCatalogState = Schema.Literal("active", "hidden");

export type SignalCatalogState = typeof SignalCatalogState.Type;

export const SignalAudiencePolicy = Schema.Union(
	strictStruct({ kind: Schema.Literal("actor") }),
	strictStruct({
		kind: Schema.Literal("related_users"),
		relationshipSchemaId: RelationshipSchemaId,
		subjectSide: Schema.Literal("source", "target"),
	}),
);

export type SignalAudiencePolicy = typeof SignalAudiencePolicy.Type;

export const AutomationOrigin = Schema.Union(
	strictStruct({ kind: Schema.Literal("api") }),
	strictStruct({ kind: Schema.Literal("bootstrap") }),
	strictStruct({ kind: Schema.Literal("provider_refresh") }),
	strictStruct({
		kind: Schema.Literal("import"),
		importRunId: Schema.optional(ImportRunId),
	}),
	strictStruct({
		integrationId: IntegrationId,
		kind: Schema.Literal("integration"),
		importRunId: Schema.optional(ImportRunId),
	}),
	strictStruct({
		executionId: Schema.String,
		kind: Schema.Literal("automation"),
	}),
);

export type AutomationOrigin = typeof AutomationOrigin.Type;
