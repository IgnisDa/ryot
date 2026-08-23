import { Schema } from "effect";

import { IntegrationId, SandboxScriptId, SubscriptionRunId, UserId } from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";
import { strictStruct } from "../../schema/utils";
import { AutomationOrigin } from "../automations/schemas";
import { SANDBOX_HOST_CAPABILITIES } from "./wire";

export const ProviderInformation = Schema.Struct({
	source: Schema.String,
	canonicalLanguage: Schema.optional(Schema.String),
});

export type ProviderInformation = Schema.Schema.Type<typeof ProviderInformation>;

export const SandboxScriptMetadata = Schema.Struct({
	name: Schema.optional(Schema.String),
	slug: Schema.optional(Schema.String),
	capabilities: Schema.optional(Schema.Array(Schema.String)),
	searchOptionsSchema: Schema.optional(Schema.toType(AppSchema)),
	requiredPluginConfigKeys: Schema.optional(Schema.Array(Schema.String)),
	requiredSystemConfigKeys: Schema.optional(Schema.Array(Schema.String)),
	kind: Schema.optional(
		Schema.Literals(["script", "operation", "workflow", "provider", "automation"]),
	),
});

export type SandboxScriptMetadata = Schema.Schema.Type<typeof SandboxScriptMetadata>;

const SandboxScriptManifestFields = {
	name: Schema.String,
	slug: Schema.String,
	requiredPluginConfigKeys: Schema.Array(Schema.String),
	requiredSystemConfigKeys: Schema.Array(Schema.String),
	capabilities: Schema.Array(Schema.Literals([...SANDBOX_HOST_CAPABILITIES])),
};

export const SandboxScriptManifest = Schema.Union([
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("script") }),
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("operation") }),
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("automation") }),
	Schema.Struct({
		...SandboxScriptManifestFields,
		capabilities: Schema.Tuple([]),
		kind: Schema.Literal("workflow"),
	}),
	Schema.Struct({
		...SandboxScriptManifestFields,
		kind: Schema.Literal("provider"),
		searchOptionsSchema: Schema.optional(Schema.toType(AppSchema)),
	}),
]);

export type SandboxScriptManifest = Schema.Schema.Type<typeof SandboxScriptManifest>;

export const SandboxCompilationDiagnostic = Schema.Struct({
	code: Schema.String,
	file: Schema.String,
	line: Schema.Number,
	column: Schema.Number,
	message: Schema.String,
	length: Schema.optional(Schema.Number),
	severity: Schema.Literals(["error", "warning", "info"]),
});

export type SandboxCompilationDiagnostic = Schema.Schema.Type<typeof SandboxCompilationDiagnostic>;

export class SandboxCompilationFailure extends Schema.TaggedError<SandboxCompilationFailure>()(
	"SandboxCompilationFailure",
	{ message: Schema.String, diagnostics: Schema.Array(SandboxCompilationDiagnostic) },
) {}

export const EnqueueSandboxBody = strictStruct({
	scriptId: SandboxScriptId,
	context: Schema.optional(Schema.Unknown),
});

export type EnqueueSandboxBody = Schema.Schema.Type<typeof EnqueueSandboxBody>;

export const EnqueueResponse = Schema.Struct({ jobId: Schema.String });

export const SandboxExecutionSubject = Schema.Union([
	strictStruct({ type: Schema.Literal("system") }),
	// `integrationId` is the integration the execution belongs to. Only trusted kernel dispatch sets
	// it, so a script can never widen its own credential scope by supplying an id.
	strictStruct({
		userId: UserId,
		type: Schema.Literal("user"),
		integrationId: Schema.optional(IntegrationId),
	}),
	strictStruct({
		userId: UserId,
		type: Schema.Literal("subscription"),
		subscriptionRun: strictStruct({
			id: SubscriptionRunId,
			origin: AutomationOrigin,
			occurredAt: Schema.String,
		}),
	}),
]);

export type SandboxExecutionSubject = Schema.Schema.Type<typeof SandboxExecutionSubject>;

export const SandboxExecutionGrants = strictStruct({
	artifactPath: Schema.optional(Schema.String),
	artifactOwnerExecutionId: Schema.optional(Schema.String),
	namedArtifactPaths: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export type SandboxExecutionGrants = Schema.Schema.Type<typeof SandboxExecutionGrants>;

export const SandboxExecutionPayload = strictStruct({
	context: Schema.Unknown,
	scriptId: SandboxScriptId,
	executionId: Schema.String,
	subject: SandboxExecutionSubject,
	startedAt: Schema.optional(Schema.String),
	grants: Schema.optional(SandboxExecutionGrants),
	workflowExecutionId: Schema.optional(Schema.String),
});

export type SandboxExecutionPayload = Schema.Schema.Type<typeof SandboxExecutionPayload>;

const SandboxTiming = Schema.Struct({ totalMs: Schema.Number, executionMs: Schema.Number });

const SandboxPendingResult = Schema.Struct({ status: Schema.Literal("pending") });

const SandboxFailedResult = Schema.Struct({
	error: Schema.String,
	status: Schema.Literal("failed"),
});

export const SandboxExecutionError = Schema.Struct({
	message: Schema.String,
	line: Schema.optional(Schema.Number),
	stack: Schema.optional(Schema.String),
	column: Schema.optional(Schema.Number),
	phase: Schema.Literals(["load", "input", "execute", "output"]),
});

export type SandboxExecutionError = Schema.Schema.Type<typeof SandboxExecutionError>;

export const SandboxCompletedResult = Schema.Struct({
	value: Schema.Unknown,
	logs: Schema.Array(Schema.String),
	status: Schema.Literal("completed"),
	timing: Schema.optional(SandboxTiming),
	error: Schema.NullOr(SandboxExecutionError),
});

export type SandboxCompletedResult = Schema.Schema.Type<typeof SandboxCompletedResult>;

export const SandboxRunResult = Schema.Union([
	SandboxFailedResult,
	SandboxPendingResult,
	SandboxCompletedResult,
]);

export type SandboxRunResult = Schema.Schema.Type<typeof SandboxRunResult>;
