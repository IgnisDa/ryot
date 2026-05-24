import { Schema } from "effect";

export const SandboxScriptMetadata = Schema.Struct({
	allowedHostFunctions: Schema.optional(Schema.Array(Schema.String)),
	requiredAppConfigKeys: Schema.optional(Schema.Array(Schema.String)),
});

export type SandboxScriptMetadata = Schema.Schema.Type<typeof SandboxScriptMetadata>;

export const SandboxScript = Schema.Struct({
	id: Schema.String,
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
	scriptId: Schema.String,
	driverName: Schema.String,
	context: Schema.optional(Schema.Unknown),
});

export type EnqueueSandboxBody = Schema.Schema.Type<typeof EnqueueSandboxBody>;

export const EnqueueResponse = Schema.Struct({ jobId: Schema.String });

export const SandboxExecutionPayload = Schema.Struct({
	userId: Schema.String,
	context: Schema.Unknown,
	scriptId: Schema.String,
	driverName: Schema.String,
	executionId: Schema.String,
});

export type SandboxExecutionPayload = Schema.Schema.Type<typeof SandboxExecutionPayload>;

export const SandboxTiming = Schema.Struct({
	totalMs: Schema.Number,
	executionMs: Schema.Number,
});

export const SandboxPendingResult = Schema.Struct({
	status: Schema.Literal("pending"),
});

export const SandboxFailedResult = Schema.Struct({
	error: Schema.String,
	status: Schema.Literal("failed"),
});

export const SandboxCompletedResult = Schema.Struct({
	value: Schema.Unknown,
	status: Schema.Literal("completed"),
	logs: Schema.Array(Schema.String),
	error: Schema.NullOr(Schema.String),
	timing: Schema.optional(SandboxTiming),
});

export type SandboxCompletedResult = Schema.Schema.Type<typeof SandboxCompletedResult>;

export const SandboxRunResult = Schema.Union(
	SandboxFailedResult,
	SandboxPendingResult,
	SandboxCompletedResult,
);

export type SandboxRunResult = Schema.Schema.Type<typeof SandboxRunResult>;
