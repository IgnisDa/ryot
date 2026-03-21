import { SandboxExecutionError } from "@ryot/contract/modules/sandbox/schemas";
import { Schema } from "effect";

const SandboxTiming = Schema.Struct({
	totalMs: Schema.Finite,
	executionMs: Schema.Finite,
});

export const SandboxExecutionResult = Schema.Struct({
	value: Schema.Unknown,
	logs: Schema.Array(Schema.String),
	timing: Schema.optional(SandboxTiming),
	status: Schema.Literal("completed"),
	error: Schema.NullOr(SandboxExecutionError),
	harvest: Schema.optional(
		Schema.NullOr(Schema.Struct({ chunkHandles: Schema.Array(Schema.String) })),
	),
});

export type SandboxExecutionResult = Schema.Schema.Type<typeof SandboxExecutionResult>;
