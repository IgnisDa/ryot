import {
	SandboxExecutionGrants,
	SandboxExecutionSubject,
} from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Schema } from "effect";

import { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";

export const SandboxScriptWorkflowPayload = Schema.Struct({
	input: jsonValueSchema,
	scriptId: SandboxScriptId,
	executionId: Schema.String,
	subject: SandboxExecutionSubject,
	startedAt: Schema.optional(Schema.String),
	grants: Schema.optional(SandboxExecutionGrants),
	pluginRevision: Schema.optional(SandboxPluginRevision),
	resolutionMode: Schema.Literals(["active", "exact"]),
	resultMode: Schema.optional(Schema.Literal("execution")),
});

export type SandboxScriptWorkflowPayload = Schema.Schema.Type<typeof SandboxScriptWorkflowPayload>;
