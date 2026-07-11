import {
	SANDBOX_HOST_CAPABILITIES,
	type SandboxManifest as SdkSandboxScriptManifest,
} from "@ryot/sandbox-sdk/core";
import { Schema } from "effect";

import { SandboxScriptId, SubscriptionRunId, UserId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { AutomationOrigin } from "../automations/schemas";

export const ProviderInformation = Schema.Struct({
	source: Schema.String,
	canonicalLanguage: Schema.optional(Schema.String),
});

export type ProviderInformation = Schema.Schema.Type<typeof ProviderInformation>;

export const SandboxScriptMetadata = Schema.Struct({
	name: Schema.optional(Schema.String),
	slug: Schema.optional(Schema.String),
	capabilities: Schema.optional(Schema.Array(Schema.String)),
	requiredAppConfigKeys: Schema.optional(Schema.Array(Schema.String)),
	kind: Schema.optional(
		Schema.Literal("script", "activity", "operation", "workflow", "provider", "automation"),
	),
});

export type SandboxScriptMetadata = Schema.Schema.Type<typeof SandboxScriptMetadata>;

const SandboxScriptManifestFields = {
	name: Schema.String,
	slug: Schema.String,
	requiredAppConfigKeys: Schema.Array(Schema.String),
	capabilities: Schema.Array(Schema.Literal(...SANDBOX_HOST_CAPABILITIES)),
};

export const SandboxScriptManifest = Schema.Union(
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("script") }),
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("activity") }),
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("operation") }),
	Schema.Struct({
		...SandboxScriptManifestFields,
		kind: Schema.Literal("workflow"),
		capabilities: Schema.Tuple(),
	}),
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("automation") }),
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("provider") }),
) satisfies Schema.Schema<SdkSandboxScriptManifest>;

export type SandboxScriptManifest = Schema.Schema.Type<typeof SandboxScriptManifest>;

export const SandboxCompilationDiagnostic = Schema.Struct({
	code: Schema.String,
	file: Schema.String,
	line: Schema.Number,
	column: Schema.Number,
	message: Schema.String,
	length: Schema.optional(Schema.Number),
	severity: Schema.Literal("error", "warning", "info"),
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

export const ExecutionAuthority = Schema.Union(
	strictStruct({ type: Schema.Literal("user"), userId: UserId }),
	strictStruct({ type: Schema.Literal("system") }),
	strictStruct({
		type: Schema.Literal("subscription"),
		userId: UserId,
		subscriptionRun: strictStruct({
			id: SubscriptionRunId,
			origin: AutomationOrigin,
			occurredAt: Schema.String,
		}),
	}),
);

export type ExecutionAuthority = Schema.Schema.Type<typeof ExecutionAuthority>;

export const SandboxExecutionGrants = strictStruct({
	artifactPath: Schema.optional(Schema.String),
});

export type SandboxExecutionGrants = Schema.Schema.Type<typeof SandboxExecutionGrants>;

export const SandboxExecutionPayload = strictStruct({
	context: Schema.Unknown,
	scriptId: SandboxScriptId,
	executionId: Schema.String,
	authority: ExecutionAuthority,
	grants: Schema.optional(SandboxExecutionGrants),
});

export type SandboxExecutionPayload = Schema.Schema.Type<typeof SandboxExecutionPayload>;

const SandboxTiming = Schema.Struct({
	totalMs: Schema.Number,
	executionMs: Schema.Number,
});

const SandboxPendingResult = Schema.Struct({
	status: Schema.Literal("pending"),
});

const SandboxFailedResult = Schema.Struct({
	error: Schema.String,
	status: Schema.Literal("failed"),
});

export const SandboxExecutionError = Schema.Struct({
	message: Schema.String,
	line: Schema.optional(Schema.Number),
	stack: Schema.optional(Schema.String),
	column: Schema.optional(Schema.Number),
	phase: Schema.Literal("load", "input", "execute", "output"),
});

export type SandboxExecutionError = Schema.Schema.Type<typeof SandboxExecutionError>;

export const SandboxCompletedResult = Schema.Struct({
	value: Schema.Unknown,
	status: Schema.Literal("completed"),
	logs: Schema.Array(Schema.String),
	timing: Schema.optional(SandboxTiming),
	error: Schema.NullOr(SandboxExecutionError),
});

export type SandboxCompletedResult = Schema.Schema.Type<typeof SandboxCompletedResult>;

export const SandboxRunResult = Schema.Union(
	SandboxFailedResult,
	SandboxPendingResult,
	SandboxCompletedResult,
);

export type SandboxRunResult = Schema.Schema.Type<typeof SandboxRunResult>;
