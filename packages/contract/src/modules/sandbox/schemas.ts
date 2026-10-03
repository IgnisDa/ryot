import { Schema } from "effect";

import { SandboxFailureKind } from "../../errors";
import { AccountGeneration } from "../../schema/account-generation";
import {
	ImportRunId,
	IntegrationId,
	PluginId,
	PluginRevisionId,
	PluginConfigRevisionId,
	SandboxScriptId,
	UserId,
} from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";
import { strictStruct } from "../../schema/utils";
import {
	AutomationAfterInputProjection,
	AutomationInvocationFields,
	AutomationPolicyInputProjection,
	ExecutionLane,
} from "../automations/lifecycle";
import { SandboxExecutionMetadata } from "../plugins/execution-metadata";
import { SandboxBoundaryReason } from "./boundary-reason";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "./wire";

export const ProviderInformation = Schema.Struct({
	source: Schema.String,
	canonicalLanguage: Schema.optional(Schema.String),
});

export type ProviderInformation = Schema.Schema.Type<typeof ProviderInformation>;

export const SandboxScriptMetadata = Schema.Struct({
	name: Schema.optional(Schema.String),
	slug: Schema.optional(Schema.String),
	capabilities: Schema.optional(Schema.Array(Schema.String)),
	runtimeImports: SandboxExecutionMetadata.fields.runtimeImports,
	searchOptionsSchema: Schema.optional(Schema.toType(AppSchema)),
	requiredPluginConfigKeys: Schema.optional(Schema.Array(Schema.String)),
	automationType: Schema.optional(Schema.Literals(["automation", "policy"])),
	oauthConnectionFields: Schema.optional(SandboxExecutionMetadata.fields.oauthConnectionFields),
	executableDependencies: Schema.optional(SandboxExecutionMetadata.fields.executableDependencies),
	optionalPluginConfigKeys: Schema.optional(
		SandboxExecutionMetadata.fields.optionalPluginConfigKeys,
	),
	kind: Schema.optional(
		Schema.Literals(["script", "operation", "workflow", "provider", "automation"]),
	),
	inputProjection: Schema.optional(
		Schema.Union([AutomationAfterInputProjection, AutomationPolicyInputProjection]),
	),
});

export type SandboxScriptMetadata = Schema.Schema.Type<typeof SandboxScriptMetadata>;

const SandboxScriptManifestFields = {
	...SandboxExecutionMetadata.fields,
	name: Schema.String,
	slug: Schema.String,
};

export const SandboxScriptManifest = Schema.Union([
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("script") }),
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("operation") }),
	Schema.Struct({
		...SandboxScriptManifestFields,
		kind: Schema.Literal("automation"),
		automationType: Schema.Literal("automation"),
		inputProjection: AutomationAfterInputProjection,
	}),
	Schema.Struct({
		...SandboxScriptManifestFields,
		kind: Schema.Literal("automation"),
		automationType: Schema.Literal("policy"),
		inputProjection: AutomationPolicyInputProjection,
		capabilities: Schema.Array(Schema.Literals([...POLICY_SAFE_SANDBOX_CAPABILITIES])),
	}),
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
	line: Schema.Finite,
	column: Schema.Finite,
	message: Schema.String,
	length: Schema.optional(Schema.Finite),
	severity: Schema.Literals(["error", "warning", "info"]),
});

export type SandboxCompilationDiagnostic = Schema.Schema.Type<typeof SandboxCompilationDiagnostic>;

export class SandboxCompilationFailure extends Schema.TaggedError<SandboxCompilationFailure>()(
	"SandboxCompilationFailure",
	{ message: Schema.String, diagnostics: Schema.Array(SandboxCompilationDiagnostic) },
) {}

export const EnqueueSandboxBody = strictStruct({
	lane: ExecutionLane,
	scriptId: SandboxScriptId,
	context: Schema.optional(Schema.Unknown),
});

export type EnqueueSandboxBody = Schema.Schema.Type<typeof EnqueueSandboxBody>;

export const EnqueueResponse = Schema.Struct({ jobId: Schema.String });

const automationRunSubjectFields = {
	type: Schema.Literal("automation-run"),
	runId: AutomationInvocationFields.runId,
	stage: Schema.Literals(["before", "after"]),
	triggerId: AutomationInvocationFields.triggerId,
	causation: AutomationInvocationFields.causation,
	accountGeneration: Schema.NullOr(AccountGeneration),
	executionUserId: AutomationInvocationFields.executionUserId,
};

export const SandboxExecutionSubject = Schema.Union([
	strictStruct({ type: Schema.Literal("system") }),
	// Only trusted kernel dispatch sets integration and import run IDs, so scripts cannot widen
	// credential or snapshot scope by supplying an ID.
	strictStruct({
		userId: UserId,
		type: Schema.Literal("user"),
		accountGeneration: AccountGeneration,
		importRunId: Schema.optional(ImportRunId),
		integrationId: Schema.optional(IntegrationId),
		integrationRunId: Schema.optional(ImportRunId),
	}),
	strictStruct({
		...automationRunSubjectFields,
		pluginId: PluginId,
		pluginRevisionId: PluginRevisionId,
		pluginConfigRevisionId: PluginConfigRevisionId,
	}),
	strictStruct({
		...automationRunSubjectFields,
		pluginId: Schema.Null,
		pluginRevisionId: Schema.Null,
		pluginConfigRevisionId: Schema.Null,
	}),
]).pipe(
	Schema.check(
		Schema.makeFilter((subject) => {
			if (subject.type === "system") {
				return true;
			}
			const userId = subject.type === "user" ? subject.userId : subject.executionUserId;
			return (
				(userId === null
					? subject.accountGeneration === null
					: subject.accountGeneration?.userId === userId) ||
				"Sandbox account generation must match its execution user"
			);
		}),
	),
);

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

const SandboxTiming = Schema.Struct({ totalMs: Schema.Finite, executionMs: Schema.Finite });

const SandboxPendingResult = Schema.Struct({ status: Schema.Literal("pending") });

const SandboxFailedResult = Schema.Struct({
	error: Schema.String,
	status: Schema.Literal("failed"),
});

export const SandboxExecutionError = Schema.Struct({
	message: Schema.String,
	kind: SandboxFailureKind,
	line: Schema.optional(Schema.Finite),
	stack: Schema.optional(Schema.String),
	column: Schema.optional(Schema.Finite),
	data: Schema.optional(SandboxBoundaryReason),
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
