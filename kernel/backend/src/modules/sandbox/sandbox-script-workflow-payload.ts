import { ExecutionAuthority, SandboxExecutionGrants } from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Schema } from "effect";

export const SandboxScriptWorkflowPayload = Schema.Struct({
	input: jsonValueSchema,
	scriptId: SandboxScriptId,
	executionId: Schema.String,
	authority: ExecutionAuthority,
	startedAt: Schema.optional(Schema.String),
	grants: Schema.optional(SandboxExecutionGrants),
	resolutionMode: Schema.Literals(["active", "exact"]),
	resultMode: Schema.optional(Schema.Literal("execution")),
});

export type SandboxScriptWorkflowPayload = Schema.Schema.Type<typeof SandboxScriptWorkflowPayload>;
