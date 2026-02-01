import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Schema } from "effect";

import {
	AutomationRuleId,
	ImportRunId,
	IntegrationId,
	RelationshipSchemaSlug,
	SignalSchemaSlug,
} from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";
import { strictStruct } from "../../schema/utils";

export const AutomationRuleKind = Schema.Literal("policy", "subscription");

export type AutomationRuleKind = typeof AutomationRuleKind.Type;

export const AutomationOperation = Schema.Literal("create", "update", "delete", "signal");

export type AutomationOperation = typeof AutomationOperation.Type;

export const AutomationRuleMetadata = jsonValueSchema;

export type AutomationRuleMetadata = typeof AutomationRuleMetadata.Type;

export const AutomationProperties = Schema.Record({
	key: Schema.String,
	value: AutomationRuleMetadata,
});

export const AutomationPolicyResult = Schema.Union(
	strictStruct({ action: Schema.Literal("allow") }),
	strictStruct({ action: Schema.Literal("skip"), reason: Schema.String }),
	strictStruct({
		action: Schema.Literal("replace"),
		body: strictStruct({
			occurredAt: Schema.optional(Schema.String),
			sessionEntityId: Schema.optional(Schema.NullOr(Schema.String)),
			properties: Schema.optional(Schema.Record({ key: Schema.String, value: jsonValueSchema })),
		}),
	}),
);

export type AutomationPolicyResult = typeof AutomationPolicyResult.Type;

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
		relationshipSchemaSlug: RelationshipSchemaSlug,
		subjectSide: Schema.Literal("source", "target"),
	}),
);

export type SignalAudiencePolicy = typeof SignalAudiencePolicy.Type;

export const CatalogSignalSchema = Schema.Struct({
	id: SignalSchemaSlug,
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
});

export type CatalogSignalSchema = typeof CatalogSignalSchema.Type;

export const InstalledNotificationRule = Schema.Struct({
	name: Schema.String,
	id: AutomationRuleId,
	isActive: Schema.Boolean,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	signalSchema: CatalogSignalSchema,
});

export type InstalledNotificationRule = typeof InstalledNotificationRule.Type;

export const InstallNotificationRuleBody = strictStruct({
	signalSchemaSlug: SignalSchemaSlug,
});

export type InstallNotificationRuleBody = typeof InstallNotificationRuleBody.Type;

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
