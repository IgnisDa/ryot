import {
	type ProviderInformation as SdkProviderInformation,
	SANDBOX_HOST_CAPABILITIES,
	type SandboxManifest as SdkSandboxScriptManifest,
} from "@ryot/sandbox-sdk";
import { Schema } from "effect";

import { SandboxScriptId, UserId } from "../../schema/brands";

export const ProviderInformation = Schema.Struct({
	source: Schema.String,
	canonicalLanguage: Schema.optional(Schema.String),
}) satisfies Schema.Schema<SdkProviderInformation>;

export type ProviderInformation = Schema.Schema.Type<typeof ProviderInformation>;

export const SandboxScriptMetadata = Schema.Struct({
	name: Schema.optional(Schema.String),
	slug: Schema.optional(Schema.String),
	providerInformation: Schema.optional(ProviderInformation),
	capabilities: Schema.optional(Schema.Array(Schema.String)),
	mode: Schema.optional(Schema.Literal("before_create", "after_create")),
	requiredAppConfigKeys: Schema.optional(Schema.Array(Schema.String)),
	kind: Schema.optional(Schema.Literal("script", "provider", "trigger", "automation")),
});

export type SandboxScriptMetadata = Schema.Schema.Type<typeof SandboxScriptMetadata>;

const SandboxScriptManifestFields = {
	name: Schema.String,
	slug: Schema.String,
	requiredAppConfigKeys: Schema.mutable(Schema.Array(Schema.String)),
	capabilities: Schema.mutable(Schema.Array(Schema.Literal(...SANDBOX_HOST_CAPABILITIES))),
};

export const SandboxScriptManifest = Schema.Union(
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("script") }),
	Schema.Struct({ ...SandboxScriptManifestFields, kind: Schema.Literal("automation") }),
	Schema.Struct({
		...SandboxScriptManifestFields,
		kind: Schema.Literal("provider"),
		providerInformation: ProviderInformation,
	}),
	Schema.Struct({
		...SandboxScriptManifestFields,
		kind: Schema.Literal("trigger"),
		mode: Schema.Literal("before_create", "after_create"),
	}),
) satisfies Schema.Schema<SdkSandboxScriptManifest>;

export type SandboxScriptManifest = Schema.Schema.Type<typeof SandboxScriptManifest>;

export const SandboxScript = Schema.Struct({
	id: SandboxScriptId,
	slug: Schema.String,
	name: Schema.String,
	source: Schema.String,
	manifest: SandboxScriptManifest,
});

export type SandboxScript = Schema.Schema.Type<typeof SandboxScript>;

export const CreateSandboxScriptBody = Schema.Struct({
	source: Schema.String,
});

export type CreateSandboxScriptBody = Schema.Schema.Type<typeof CreateSandboxScriptBody>;

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

export const EnqueueSandboxBody = Schema.Struct({
	scriptId: SandboxScriptId,
	driverName: Schema.String,
	context: Schema.optional(Schema.Unknown),
});

export type EnqueueSandboxBody = Schema.Schema.Type<typeof EnqueueSandboxBody>;

export const EnqueueResponse = Schema.Struct({ jobId: Schema.String });

export const SandboxExecutionPayload = Schema.Struct({
	context: Schema.Unknown,
	scriptId: SandboxScriptId,
	driverName: Schema.String,
	executionId: Schema.String,
	userId: Schema.NullOr(UserId),
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
