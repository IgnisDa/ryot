import { Schema } from "effect";

export const SandboxRunStatus = Schema.Literal("queued", "running", "completed", "failed");

export type SandboxRunStatus = typeof SandboxRunStatus.Type;

export const RunSandboxPayload = Schema.Struct({
	context: Schema.optional(Schema.Unknown),
	driverName: Schema.String,
	scriptSlug: Schema.String,
});

export type RunSandboxPayload = typeof RunSandboxPayload.Type;

export const SandboxRunResult = Schema.Struct({
	id: Schema.String,
	runId: Schema.NullOr(Schema.String),
	logs: Schema.NullOr(Schema.String),
	status: SandboxRunStatus,
	result: Schema.NullOr(Schema.Unknown),
	error: Schema.NullOr(Schema.String),
	driverName: Schema.String,
	scriptSlug: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
});

export type SandboxRunResult = typeof SandboxRunResult.Type;
