import { Schema } from "effect";

import { SandboxScriptId, UserId } from "../../schema/brands";

export const ProviderInformation = Schema.Struct({
	source: Schema.String,
	canonicalLanguage: Schema.optional(Schema.String),
});

export type ProviderInformation = Schema.Schema.Type<typeof ProviderInformation>;

export const SandboxScriptMetadata = Schema.Struct({
	providerInformation: Schema.optional(ProviderInformation),
	allowedHostFunctions: Schema.optional(Schema.Array(Schema.String)),
	requiredAppConfigKeys: Schema.optional(Schema.Array(Schema.String)),
});

export type SandboxScriptMetadata = Schema.Schema.Type<typeof SandboxScriptMetadata>;

export const SandboxScript = Schema.Struct({
	id: SandboxScriptId,
	slug: Schema.String,
	code: Schema.String,
	name: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
});

export type SandboxScript = Schema.Schema.Type<typeof SandboxScript>;

export const CreateSandboxScriptBody = Schema.Struct({
	code: Schema.String,
	name: Schema.optional(Schema.String),
	slug: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
});

export type CreateSandboxScriptBody = Schema.Schema.Type<typeof CreateSandboxScriptBody>;

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
	capabilityCeiling: Schema.optional(Schema.Array(Schema.String)),
	executionKind: Schema.Literal("direct", "policy", "provider", "subscription"),
	automationRun: Schema.optional(
		Schema.Struct({
			runId: Schema.String,
			correlationId: Schema.String,
			automationDepth: Schema.Number,
			occurrenceAt: Schema.optional(Schema.DateTimeUtc),
		}),
	),
});

export type SandboxExecutionPayload = Schema.Schema.Type<typeof SandboxExecutionPayload>;

export const SandboxProviderValue = Schema.Struct({
	value: Schema.Unknown,
	kind: Schema.Literal("provider_value"),
});

export type SandboxProviderValue = Schema.Schema.Type<typeof SandboxProviderValue>;

export const SandboxProviderArtifactReference = Schema.Struct({
	id: Schema.String,
	kind: Schema.Literal("provider_artifact"),
});

export type SandboxProviderArtifactReference = Schema.Schema.Type<
	typeof SandboxProviderArtifactReference
>;

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

export const SandboxCompletedResult = Schema.Struct({
	value: Schema.Unknown,
	status: Schema.Literal("completed"),
	logs: Schema.Array(Schema.String),
	error: Schema.NullOr(Schema.String),
	timing: Schema.optional(SandboxTiming),
	scriptAudit: Schema.optional(Schema.Struct({ hash: Schema.String, updatedAt: Schema.String })),
});

export type SandboxCompletedResult = Schema.Schema.Type<typeof SandboxCompletedResult>;

export const SandboxRunResult = Schema.Union(
	SandboxFailedResult,
	SandboxPendingResult,
	SandboxCompletedResult,
);

export type SandboxRunResult = Schema.Schema.Type<typeof SandboxRunResult>;
