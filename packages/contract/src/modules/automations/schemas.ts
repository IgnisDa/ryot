import { Schema } from "effect";

import {
	NotificationSubscriptionId,
	RelationshipSchemaSlug,
	SignalSchemaSlug,
} from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";
import { strictStruct } from "../../schema/utils";
import { jsonValueSchema } from "../sandbox/wire";

export const AutomationRuleMetadata = jsonValueSchema;

export type AutomationRuleMetadata = typeof AutomationRuleMetadata.Type;

export const SignalCatalogState = Schema.Literals(["active", "hidden"]);

export type SignalCatalogState = typeof SignalCatalogState.Type;

export const SignalAudiencePolicy = Schema.Union([
	strictStruct({ kind: Schema.Literal("actor") }),
	strictStruct({
		kind: Schema.Literal("related_users"),
		relationshipSchemaSlug: RelationshipSchemaSlug,
		subjectSide: Schema.Literals(["source", "target"]),
	}),
]);

export type SignalAudiencePolicy = typeof SignalAudiencePolicy.Type;

export const CatalogSignalSchema = Schema.Struct({
	name: Schema.String,
	slug: Schema.String,
	id: SignalSchemaSlug,
	propertiesSchema: AppSchema,
});

export type CatalogSignalSchema = typeof CatalogSignalSchema.Type;

export const InstalledNotificationRule = Schema.Struct({
	name: Schema.String,
	isActive: Schema.Boolean,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	id: NotificationSubscriptionId,
	signalSchema: CatalogSignalSchema,
});

export type InstalledNotificationRule = typeof InstalledNotificationRule.Type;

export const InstallNotificationRuleBody = strictStruct({ signalSchemaSlug: SignalSchemaSlug });

export type InstallNotificationRuleBody = typeof InstallNotificationRuleBody.Type;

const AutomationNotFoundReason = Schema.Union([
	Schema.Struct({ ruleId: NotificationSubscriptionId, code: Schema.Literal("rule-not-found") }),
	Schema.Struct({
		signalSchemaSlug: SignalSchemaSlug,
		code: Schema.Literal("signal-schema-not-found"),
	}),
]);

const AutomationConflictReason = Schema.Union([
	Schema.Struct({
		signalSchemaSlug: SignalSchemaSlug,
		code: Schema.Literal("rule-already-installed"),
	}),
]);

export class AutomationNotFoundError extends Schema.TaggedError<AutomationNotFoundError>()(
	"AutomationNotFoundError",
	{ reason: AutomationNotFoundReason },
) {}

export class AutomationConflictError extends Schema.TaggedError<AutomationConflictError>()(
	"AutomationConflictError",
	{ reason: AutomationConflictReason },
) {}
