import {
	SandboxExecutionGrants,
	SandboxExecutionSubject,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { Schema } from "effect";

import { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";

export const SandboxScriptWorkflowPayload = Schema.Struct({
	input: jsonValueSchema,
	scriptId: SandboxScriptId,
	executionId: Schema.String,
	subject: SandboxExecutionSubject,
	startedAt: Schema.optional(Schema.String),
	grants: Schema.optional(SandboxExecutionGrants),
	resolutionMode: Schema.Literals(["active", "exact"]),
	/** Interactive replays run on the reserved worker; child workflows always run in the background. */
	lane: Schema.optional(Schema.Literal("interactive")),
	pluginRevision: Schema.optional(SandboxPluginRevision),
	resultMode: Schema.optional(Schema.Literal("execution")),
});

export type SandboxScriptWorkflowPayload = Schema.Schema.Type<typeof SandboxScriptWorkflowPayload>;
