import { Schema } from "effect";

import { NotificationSubscriptionId, RelationshipSchemaSlug } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { SignalSchemaReference } from "../plugins/references";

export const AutomationRuleMetadata = JsonValue;

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

export const InstallNotificationRuleBody = strictStruct({ signalSchema: SignalSchemaReference });

export type InstallNotificationRuleBody = typeof InstallNotificationRuleBody.Type;

const AutomationNotFoundReason = Schema.Union([
	Schema.Struct({ ruleId: NotificationSubscriptionId, code: Schema.Literal("rule-not-found") }),
	Schema.Struct({
		signalSchema: SignalSchemaReference,
		code: Schema.Literal("signal-schema-not-found"),
	}),
]);

const AutomationConflictReason = Schema.Union([
	Schema.Struct({
		signalSchema: SignalSchemaReference,
		code: Schema.Literal("rule-already-installed"),
	}),
]);

export class AutomationNotFoundError extends Schema.TaggedError<
	AutomationNotFoundError,
	{ readonly brand: unique symbol }
>()("AutomationNotFoundError", { reason: AutomationNotFoundReason }) {}

export class AutomationConflictError extends Schema.TaggedError<
	AutomationConflictError,
	{ readonly brand: unique symbol }
>()("AutomationConflictError", { reason: AutomationConflictReason }) {}
