import { Schema } from "effect";

import {
	AutomationOccurrenceId,
	AutomationRuleId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	ImportRunId,
	IntegrationId,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SignalId,
	SignalSchemaSlug,
	UserId,
} from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";
import { strictStruct } from "../../schema/utils";
import { jsonValueSchema } from "../sandbox/wire";

export const AutomationRuleKind = Schema.Literals(["policy", "subscription"]);

export type AutomationRuleKind = typeof AutomationRuleKind.Type;

export const AutomationOperation = Schema.Literals(["create", "update", "delete", "signal"]);

export type AutomationOperation = typeof AutomationOperation.Type;

export const AutomationRuleMetadata = jsonValueSchema;

export type AutomationRuleMetadata = typeof AutomationRuleMetadata.Type;

export const AutomationProperties = Schema.Record(Schema.String, AutomationRuleMetadata);

const AutomationEntityReference = strictStruct({
	id: EntityId,
	name: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
});

const AutomationEntitySnapshot = strictStruct({
	...AutomationEntityReference.fields,
	properties: AutomationProperties,
});

const AutomationEventSnapshot = strictStruct({
	id: EventId,
	createdAt: Schema.String,
	occurredAt: Schema.String,
	properties: AutomationProperties,
	eventSchemaSlug: EventSchemaSlug,
	subject: AutomationEntityReference,
	sessionEntityId: Schema.optional(EntityId),
});

const AutomationRelationshipSnapshot = strictStruct({
	id: RelationshipId,
	properties: AutomationProperties,
	source: AutomationEntityReference,
	target: AutomationEntityReference,
	relationshipSchemaSlug: RelationshipSchemaSlug,
});

const AutomationSignalSnapshot = strictStruct({
	id: SignalId,
	occurredAt: Schema.String,
	properties: AutomationProperties,
	signalSchemaSlug: SignalSchemaSlug,
	origin: Schema.suspend(() => AutomationOrigin),
});

export const AutomationOccurrenceSource = Schema.Union([
	strictStruct({
		kind: Schema.Literal("entity"),
		after: Schema.optional(AutomationEntitySnapshot),
		before: Schema.optional(AutomationEntitySnapshot),
	}),
	strictStruct({
		kind: Schema.Literal("event"),
		after: Schema.optional(AutomationEventSnapshot),
		before: Schema.optional(AutomationEventSnapshot),
	}),
	strictStruct({
		kind: Schema.Literal("relationship"),
		after: Schema.optional(AutomationRelationshipSnapshot),
		before: Schema.optional(AutomationRelationshipSnapshot),
	}),
	strictStruct({ kind: Schema.Literal("signal"), signal: AutomationSignalSnapshot }),
	strictStruct({
		entityId: EntityId,
		externalId: Schema.String,
		providerId: SandboxProviderId,
		entitySchemaSlug: EntitySchemaSlug,
		kind: Schema.Literal("provider-entity-import"),
	}),
]);

export type AutomationOccurrenceSource = typeof AutomationOccurrenceSource.Type;

export const AutomationOccurrencePopulation = strictStruct({
	scopeEntity: AutomationEntityReference,
	rootPreviouslyPopulated: Schema.Boolean,
	parentEntity: Schema.optional(
		strictStruct({
			name: Schema.String,
			properties: AutomationProperties,
			entitySchemaSlug: EntitySchemaSlug,
		}),
	),
	batch: Schema.optional(
		strictStruct({
			id: Schema.String,
			isLeader: Schema.Boolean,
			afterCount: Schema.Number,
			beforeCount: Schema.Number,
			createdCount: Schema.Number,
			deletedCount: Schema.Number,
			updatedCount: Schema.Number,
		}),
	),
});

export type AutomationOccurrencePopulation = typeof AutomationOccurrencePopulation.Type;

export const AutomationPolicyResult = Schema.Union([
	strictStruct({ action: Schema.Literal("allow") }),
	strictStruct({ reason: Schema.String, action: Schema.Literal("skip") }),
	strictStruct({
		action: Schema.Literal("replace"),
		body: strictStruct({
			occurredAt: Schema.optional(Schema.String),
			sessionEntityId: Schema.optional(Schema.NullOr(Schema.String)),
			properties: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)),
		}),
	}),
]);

export type AutomationPolicyResult = typeof AutomationPolicyResult.Type;

export const SubscriptionRunSourceKind = Schema.Literals([
	"entity",
	"event",
	"relationship",
	"signal",
]);

export type SubscriptionRunSourceKind = typeof SubscriptionRunSourceKind.Type;

export const AutomationOccurrenceSourceKind = Schema.Literals([
	"entity",
	"event",
	"relationship",
	"signal",
	"provider-entity-import",
]);

export type AutomationOccurrenceSourceKind = typeof AutomationOccurrenceSourceKind.Type;

export const SubscriptionRunStatus = Schema.Literals([
	"queued",
	"running",
	"succeeded",
	"failed",
	"skipped",
]);

export type SubscriptionRunStatus = typeof SubscriptionRunStatus.Type;

export const SubscriptionRunTiming = strictStruct({
	totalMs: Schema.Number,
	executionMs: Schema.Number,
});

export type SubscriptionRunTiming = typeof SubscriptionRunTiming.Type;

export const SubscriptionRunSkipReason = Schema.Union([
	strictStruct({ kind: Schema.Literal("user_disabled") }),
]);

export type SubscriptionRunSkipReason = typeof SubscriptionRunSkipReason.Type;

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
	id: AutomationRuleId,
	isActive: Schema.Boolean,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	signalSchema: CatalogSignalSchema,
});

export type InstalledNotificationRule = typeof InstalledNotificationRule.Type;

export const InstallNotificationRuleBody = strictStruct({ signalSchemaSlug: SignalSchemaSlug });

export type InstallNotificationRuleBody = typeof InstallNotificationRuleBody.Type;

const AutomationNotFoundReason = Schema.Union([
	Schema.Struct({ ruleId: AutomationRuleId, code: Schema.Literal("rule-not-found") }),
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

export const AutomationOrigin = Schema.Union([
	strictStruct({ kind: Schema.Literal("api") }),
	strictStruct({ kind: Schema.Literal("bootstrap") }),
	strictStruct({ kind: Schema.Literal("provider_refresh") }),
	strictStruct({ kind: Schema.Literal("import"), importRunId: Schema.optional(ImportRunId) }),
	strictStruct({
		integrationId: IntegrationId,
		kind: Schema.Literal("integration"),
		importRunId: Schema.optional(ImportRunId),
	}),
	strictStruct({ executionId: Schema.String, kind: Schema.Literal("automation") }),
]);

export type AutomationOrigin = typeof AutomationOrigin.Type;

export const AutomationOccurrence = strictStruct({
	origin: AutomationOrigin,
	occurredAt: Schema.String,
	id: AutomationOccurrenceId,
	userId: Schema.NullOr(UserId),
	operation: AutomationOperation,
	signalId: Schema.NullOr(SignalId),
	source: AutomationOccurrenceSource,
	recordId: Schema.NullOr(Schema.String),
	sourceKind: AutomationOccurrenceSourceKind,
	population: Schema.NullOr(AutomationOccurrencePopulation),
});

export type AutomationOccurrence = typeof AutomationOccurrence.Type;
