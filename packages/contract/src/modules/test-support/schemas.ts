import { Schema } from "effect";

import { CanonicalBase64 } from "../../schema/base64";
import {
	AutomationExecutionId,
	AutomationHookSlug,
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	ImportRunId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	PluginSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import {
	AutomationRunAttempt,
	AutomationRunStatus,
	AutomationTriggerPayload,
} from "../automations/lifecycle";
import { PluginManifest } from "../plugins/manifest";
import { EnqueueSandboxBody, SandboxScriptMetadata } from "../sandbox/schemas";

const TestSupportDiagnosticReason = Schema.Union([
	Schema.Struct({ diagnostic: Schema.String, code: Schema.Literal("invalid-request") }),
	Schema.Struct({ diagnostic: Schema.String, code: Schema.Literal("operation-failed") }),
	Schema.Struct({ diagnostic: Schema.String, code: Schema.Literal("resource-conflict") }),
	Schema.Struct({ diagnostic: Schema.String, code: Schema.Literal("resource-not-found") }),
]);

export class TestSupportBadRequest extends Schema.TaggedError<TestSupportBadRequest>()(
	"TestSupportBadRequest",
	{ reason: TestSupportDiagnosticReason },
) {}
export class TestSupportNotFound extends Schema.TaggedError<TestSupportNotFound>()(
	"TestSupportNotFound",
	{ reason: TestSupportDiagnosticReason },
) {}
export class TestSupportConflict extends Schema.TaggedError<TestSupportConflict>()(
	"TestSupportConflict",
	{ reason: TestSupportDiagnosticReason },
) {}
export class TestSupportOperationFailure extends Schema.TaggedError<TestSupportOperationFailure>()(
	"TestSupportOperationFailure",
	{ reason: TestSupportDiagnosticReason },
) {}

export const TestSupportInstallSystemPluginBodyBase64 = Schema.Struct({
	manifest: PluginManifest,
	files: Schema.Record(Schema.String, CanonicalBase64),
});

export type TestSupportInstallSystemPluginBodyBase64 =
	typeof TestSupportInstallSystemPluginBodyBase64.Type;

export const TestSupportSystemPlugin = Schema.Struct({
	slug: PluginSlug,
	pluginId: PluginId,
	icon: Schema.String,
	name: Schema.String,
	version: Schema.String,
	sourceHash: Schema.String,
	description: Schema.String,
	activePluginRevisionId: PluginRevisionId,
	scope: Schema.Literals(["system", "user"]),
	installationId: Schema.NullOr(Schema.String),
	configRevisionId: Schema.NullOr(PluginConfigRevisionId),
	scripts: Schema.Array(
		Schema.Struct({ slug: Schema.String, id: SandboxScriptId, contentHash: Schema.String }),
	),
});

export type TestSupportSystemPlugin = typeof TestSupportSystemPlugin.Type;

export const TestSupportStoredSandboxScript = Schema.Struct({
	id: SandboxScriptId,
	slug: Schema.String,
	name: Schema.String,
	source: Schema.String,
	compiledCode: Schema.String,
	compiledFormat: Schema.Number,
	metadata: SandboxScriptMetadata,
	providerId: Schema.NullOr(SandboxProviderId),
});

export type TestSupportStoredSandboxScript = typeof TestSupportStoredSandboxScript.Type;

export const TestSupportEnqueueSandboxBody = strictStruct({
	...EnqueueSandboxBody.fields,
	executingUserId: UserId,
});

export type TestSupportEnqueueSandboxBody = typeof TestSupportEnqueueSandboxBody.Type;

export const TestSupportEnqueueSandboxResponse = Schema.Struct({
	jobId: Schema.String,
	executionId: Schema.String,
});

export const TestSupportSandboxReplayProjectionBody = Schema.Struct({ executionId: Schema.String });

export const TestSupportTriggerPluginCronBody = strictStruct({
	pluginSlug: PluginSlug,
	cronSlug: Schema.String,
});

export type TestSupportTriggerPluginCronBody = typeof TestSupportTriggerPluginCronBody.Type;

export const TestSupportTriggerPluginBootBody = strictStruct({
	pluginSlug: PluginSlug,
	bootSlug: Schema.String,
});

export type TestSupportTriggerPluginBootBody = typeof TestSupportTriggerPluginBootBody.Type;

export const TestSupportPluginCronResult = Schema.Union([
	Schema.Struct({
		pluginSlug: PluginSlug,
		cronSlug: Schema.String,
		status: Schema.Literal("notFound"),
	}),
	Schema.Struct({
		result: Schema.Unknown,
		pluginSlug: PluginSlug,
		cronSlug: Schema.String,
		executionId: Schema.String,
		status: Schema.Literals(["executed", "failed"]),
	}),
]);

export type TestSupportPluginCronResult = typeof TestSupportPluginCronResult.Type;

export const TestSupportStartWorkflowLoadGateBody = strictStruct({
	source: Schema.String,
	pluginSlug: PluginSlug,
	executingUserId: UserId,
	workflowSlug: Schema.String,
	providerId: SandboxProviderId,
	identifierPrefix: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
	itemCount: Schema.Int.pipe(
		Schema.check(Schema.isGreaterThan(0)),
		Schema.check(Schema.isLessThanOrEqualTo(1_001)),
	),
});

export type TestSupportStartWorkflowLoadGateBody = typeof TestSupportStartWorkflowLoadGateBody.Type;

export const TestSupportWorkflowLoadGateExecution = Schema.Struct({
	executionId: Schema.String,
	error: Schema.optional(Schema.String),
	output: Schema.optional(Schema.Unknown),
	status: Schema.Literals(["pending", "completed", "failed"]),
});

export const TestSupportWorkflowLoadGateRun = Schema.Struct({
	runId: ImportRunId,
	executionIds: Schema.Array(Schema.String),
});

export const TestSupportWorkflowLoadGateResult = Schema.Struct({
	runId: ImportRunId,
	executions: Schema.Array(TestSupportWorkflowLoadGateExecution),
});

export const TestSupportOperationalPressure = Schema.Struct({
	locks: Schema.Struct({ advisoryLocks: Schema.Number, waitingAdvisoryLocks: Schema.Number }),
	redis: Schema.Struct({
		maxHighWater: Schema.Number,
		projectionCount: Schema.Number,
		projectionErrors: Schema.Number,
	}),
	sandbox: Schema.Struct({
		totalExecutions: Schema.Number,
		activeExecutions: Schema.Number,
		maxActiveExecutions: Schema.Number,
	}),
	database: Schema.Struct({
		deadlocks: Schema.Number,
		totalConnections: Schema.Number,
		activeConnections: Schema.Number,
		lockWaitingConnections: Schema.Number,
	}),
});

const OptionalCounter = Schema.NullOr(Schema.Number);

export const TestSupportSandboxRuntimeMetrics = Schema.Struct({
	timestampMs: Schema.Number,
	totalSpawned: Schema.Number,
	totalCompleted: Schema.Number,
	workerRssBytes: Schema.Number,
	backendRssBytes: Schema.Number,
	activeProcessCount: Schema.Number,
	executions: Schema.Struct({
		total: Schema.Number,
		active: Schema.Number,
		maxActive: Schema.Number,
	}),
	deno: Schema.Struct({
		rssBytes: Schema.Number,
		processCount: Schema.Number,
		userCpuTicks: OptionalCounter,
		systemCpuTicks: OptionalCounter,
	}),
	replays: Schema.Struct({
		totalFailed: Schema.Number,
		totalStarted: Schema.Number,
		totalCompleted: Schema.Number,
		totalJournalBytes: Schema.Number,
	}),
	workers: Schema.Array(
		Schema.Struct({
			pid: Schema.Number,
			rssBytes: Schema.Number,
			userCpuTicks: OptionalCounter,
			systemCpuTicks: OptionalCounter,
			startTimeTicks: OptionalCounter,
		}),
	),
	backend: Schema.Struct({
		rssBytes: Schema.Number,
		heapUsedBytes: Schema.Number,
		externalBytes: Schema.Number,
		heapTotalBytes: Schema.Number,
		userCpuMicros: OptionalCounter,
		arrayBuffersBytes: Schema.Number,
		systemCpuMicros: OptionalCounter,
	}),
	cgroup: Schema.NullOr(
		Schema.Struct({
			pidsCurrent: OptionalCounter,
			memoryMaxBytes: OptionalCounter,
			memoryPeakBytes: OptionalCounter,
			memoryCurrentBytes: OptionalCounter,
			cpu: Schema.Struct({
				userUsec: OptionalCounter,
				usageUsec: OptionalCounter,
				systemUsec: OptionalCounter,
			}),
			events: Schema.Struct({
				low: Schema.Number,
				max: Schema.Number,
				oom: Schema.Number,
				high: Schema.Number,
				oomKill: Schema.Number,
			}),
		}),
	),
});

export const TestSupportGlobalRelationship = Schema.Struct({
	id: RelationshipId,
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	createdAt: Schema.String,
	properties: Schema.Unknown,
	relationshipSchemaSlug: RelationshipSchemaSlug,
});

export const TestSupportAutomationSourceRecord = Schema.Union([
	strictStruct({ id: EntityId, resource: Schema.Literal("entity") }),
	strictStruct({ id: EventId, resource: Schema.Literal("event") }),
	strictStruct({ id: RelationshipId, resource: Schema.Literal("relationship") }),
	strictStruct({ id: EntityId, resource: Schema.Literal("provider-entity-import") }),
]);

const automationTriggerFilterFields = {
	triggerId: Schema.optional(AutomationTriggerId),
	payload: Schema.optional(AutomationTriggerPayload),
	rootExecutionId: Schema.optional(AutomationExecutionId),
	sourceRecord: Schema.optional(TestSupportAutomationSourceRecord),
};

export const TestSupportListAutomationTriggersBody = strictStruct(automationTriggerFilterFields);
export type TestSupportListAutomationTriggersBody =
	typeof TestSupportListAutomationTriggersBody.Type;

export const TestSupportListAutomationTriggerRecipientsBody = strictStruct({
	triggerId: AutomationTriggerId,
	userId: Schema.optional(UserId),
});
export type TestSupportListAutomationTriggerRecipientsBody =
	typeof TestSupportListAutomationTriggerRecipientsBody.Type;

export const TestSupportListAutomationRunsBody = strictStruct({
	...automationTriggerFilterFields,
	status: Schema.optional(AutomationRunStatus),
	hookSlug: Schema.optional(AutomationHookSlug),
	executionUserId: Schema.optional(Schema.NullOr(UserId)),
});
export type TestSupportListAutomationRunsBody = typeof TestSupportListAutomationRunsBody.Type;

export const TestSupportListAutomationRunAttemptsBody = strictStruct({
	runId: AutomationRunId,
	status: Schema.optional(AutomationRunAttempt.fields.status),
});
export type TestSupportListAutomationRunAttemptsBody =
	typeof TestSupportListAutomationRunAttemptsBody.Type;

export const TestSupportBuiltinEntitySchema = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	id: EntitySchemaSlug,
});

export const TestSupportEntityTranslation = Schema.Struct({
	language: Schema.String,
	populatedAt: Schema.String,
	name: Schema.NullOr(Schema.String),
	properties: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
});
