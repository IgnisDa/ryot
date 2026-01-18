import { Schema } from "effect";

import {
	EntityId,
	EntitySchemaSlug,
	ImportRunId,
	PluginSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	SignalId,
	SubscriptionRunId,
	UserId,
} from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { SubscriptionRunStatus } from "../automations/schemas";
import { EnqueueSandboxBody, SandboxScriptMetadata } from "../sandbox/schemas";

export const TestSupportStoredSandboxScript = Schema.Struct({
	id: SandboxScriptId,
	slug: Schema.String,
	name: Schema.String,
	source: Schema.String,
	providerId: Schema.NullOr(SandboxProviderId),
	compiledCode: Schema.String,
	compiledFormat: Schema.Number,
	metadata: SandboxScriptMetadata,
});

export type TestSupportStoredSandboxScript = typeof TestSupportStoredSandboxScript.Type;

export const TestSupportEnqueueSandboxBody = strictStruct({
	...EnqueueSandboxBody.fields,
	executingUserId: UserId,
});

export type TestSupportEnqueueSandboxBody = typeof TestSupportEnqueueSandboxBody.Type;

export const TestSupportTriggerPluginCronBody = strictStruct({
	cronSlug: Schema.String,
	pluginSlug: PluginSlug,
});

export type TestSupportTriggerPluginCronBody = typeof TestSupportTriggerPluginCronBody.Type;

export const TestSupportPluginCronResult = Schema.Union(
	Schema.Struct({
		status: Schema.Literal("notFound"),
		cronSlug: Schema.String,
		pluginSlug: PluginSlug,
	}),
	Schema.Struct({
		lot: Schema.Literal("script", "workflow"),
		result: Schema.Unknown,
		status: Schema.Literal("executed"),
		cronSlug: Schema.String,
		pluginSlug: PluginSlug,
		executionId: Schema.String,
	}),
);

export type TestSupportPluginCronResult = typeof TestSupportPluginCronResult.Type;

export const TestSupportStartMediaPopulationGateBody = strictStruct({
	itemCount: Schema.Int.pipe(Schema.positive(), Schema.lessThanOrEqualTo(1_001)),
	executingUserId: UserId,
	identifierPrefix: Schema.String,
	providerId: SandboxProviderId,
	entitySchemaSlug: EntitySchemaSlug,
});

export type TestSupportStartMediaPopulationGateBody =
	typeof TestSupportStartMediaPopulationGateBody.Type;

export const TestSupportMediaPopulationGateExecution = Schema.Struct({
	status: Schema.Literal("pending", "completed", "failed"),
	output: Schema.optional(Schema.Unknown),
	error: Schema.optional(Schema.String),
	executionId: Schema.String,
});

export const TestSupportMediaPopulationGateRun = Schema.Struct({
	runId: ImportRunId,
	executionIds: Schema.Array(Schema.String),
});

export const TestSupportMediaPopulationGateResult = Schema.Struct({
	runId: ImportRunId,
	executions: Schema.Array(TestSupportMediaPopulationGateExecution),
});

export const TestSupportOperationalPressure = Schema.Struct({
	database: Schema.Struct({
		deadlocks: Schema.Number,
		activeConnections: Schema.Number,
		totalConnections: Schema.Number,
		lockWaitingConnections: Schema.Number,
		appPoolIdleConnections: Schema.Number,
		appPoolTotalConnections: Schema.Number,
		appPoolWaitingRequests: Schema.Number,
	}),
	locks: Schema.Struct({
		advisoryLocks: Schema.Number,
		waitingAdvisoryLocks: Schema.Number,
	}),
	redis: Schema.Struct({
		projectionCount: Schema.Number,
		projectionErrors: Schema.Number,
		maxHighWater: Schema.Number,
	}),
	sandbox: Schema.Struct({
		activeExecutions: Schema.Number,
		maxActiveExecutions: Schema.Number,
		totalExecutions: Schema.Number,
	}),
});

export const TestSupportGlobalRelationship = Schema.Struct({
	id: RelationshipId,
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	createdAt: Schema.String,
	properties: Schema.Unknown,
	relationshipSchemaSlug: RelationshipSchemaSlug,
});

export const TestSupportSignal = Schema.Struct({
	id: SignalId,
	createdAt: Schema.String,
	actorUserId: Schema.NullOr(UserId),
	recipientUserIds: Schema.Array(UserId),
	subjectEntityId: Schema.NullOr(EntityId),
});

export const TestSupportSubscriptionRun = Schema.Struct({
	id: SubscriptionRunId,
	status: SubscriptionRunStatus,
});

export const TestSupportBuiltinEntitySchema = Schema.Struct({
	id: EntitySchemaSlug,
	slug: Schema.String,
	name: Schema.String,
});

export const TestSupportEntityTranslation = Schema.Struct({
	language: Schema.String,
	populatedAt: Schema.String,
	name: Schema.NullOr(Schema.String),
	properties: Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});
