import { Schema } from "effect";

import {
	EntitySchemaSlug,
	ImportRunId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { ExecutionLane } from "../automations/lifecycle";
import { PluginManifest } from "../plugins/manifest";
import { EnqueueSandboxBody } from "../scripts/schemas";

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

export const TestSupportPluginCompiledScript = strictStruct({
	entry: Schema.String,
	javascript: Schema.String,
	format: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
});

export const TestSupportInstallSystemPluginBodyBase64 = Schema.Struct({
	manifest: PluginManifest,
	compiledScripts: Schema.Array(TestSupportPluginCompiledScript),
	compiledClient: Schema.optional(Schema.Record(Schema.String, JsonValue)),
});

export type TestSupportInstallSystemPluginBodyBase64 =
	typeof TestSupportInstallSystemPluginBodyBase64.Type;

export const TestSupportUpdateSystemPluginBodyBase64 = Schema.Struct({
	...TestSupportInstallSystemPluginBodyBase64.fields,
	contentHash: Schema.String,
});
export type TestSupportUpdateSystemPluginBodyBase64 =
	typeof TestSupportUpdateSystemPluginBodyBase64.Type;

export const TestSupportPluginWriteResult = Schema.Struct({
	pluginId: PluginId,
	activationId: Schema.String,
	activePluginRevisionId: PluginRevisionId,
	installationId: Schema.NullOr(Schema.String),
	configRevisionId: Schema.NullOr(PluginConfigRevisionId),
	scripts: Schema.Array(Schema.Struct({ slug: Schema.String, id: SandboxScriptId })),
});

export const TestSupportEnqueueSandboxBody = strictStruct({
	...EnqueueSandboxBody.fields,
	lane: ExecutionLane,
	executingUserId: UserId,
});

export type TestSupportEnqueueSandboxBody = typeof TestSupportEnqueueSandboxBody.Type;

export const TestSupportEnqueueSandboxResponse = Schema.Struct({
	jobId: Schema.String,
	executionId: Schema.String,
});

export const TestSupportSandboxReplayProjectionBody = Schema.Struct({ executionId: Schema.String });

export const TestSupportTriggerPluginCronBody = strictStruct({
	pluginId: PluginId,
	cronSlug: Schema.String,
});

export type TestSupportTriggerPluginCronBody = typeof TestSupportTriggerPluginCronBody.Type;

export const TestSupportPluginCronResult = Schema.Union([
	Schema.Struct({
		pluginId: PluginId,
		cronSlug: Schema.String,
		status: Schema.Literal("notFound"),
	}),
	Schema.Struct({
		pluginId: PluginId,
		result: Schema.Unknown,
		cronSlug: Schema.String,
		executionId: Schema.String,
		status: Schema.Literals(["executed", "failed"]),
	}),
]);

export type TestSupportPluginCronResult = typeof TestSupportPluginCronResult.Type;

export const TestSupportStartWorkflowLoadGateBody = strictStruct({
	pluginId: PluginId,
	source: Schema.String,
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
	locks: Schema.Struct({ waitingAdvisoryLocks: Schema.Finite }),
	sandbox: Schema.Struct({ totalExecutions: Schema.Finite, activeExecutions: Schema.Finite }),
	database: Schema.Struct({ deadlocks: Schema.Finite, lockWaitingConnections: Schema.Finite }),
	redis: Schema.Struct({
		projectionCount: Schema.Finite,
		projectionErrors: Schema.Finite,
		maxJournalEntries: Schema.Finite,
	}),
});
