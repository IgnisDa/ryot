import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	SandboxExecutionGrants,
	SandboxExecutionSubject,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";
import {
	ScriptInstallationInitialization,
	ScriptPluginRevision,
} from "@ryot-app/sandbox/protocol/principal";
import { Schema } from "effect";

export const ScriptExecutionWorkflowPayload = Schema.Struct({
	lane: ExecutionLane,
	input: jsonValueSchema,
	scriptId: SandboxScriptId,
	executionId: Schema.String,
	subject: SandboxExecutionSubject,
	startedAt: Schema.optional(Schema.String),
	grants: Schema.optional(SandboxExecutionGrants),
	resolutionMode: Schema.Literals(["active", "exact"]),
	pluginRevision: Schema.optional(ScriptPluginRevision),
	resultMode: Schema.optional(Schema.Literal("execution")),
	initialization: Schema.optional(ScriptInstallationInitialization),
});

export type ScriptExecutionWorkflowPayload = Schema.Schema.Type<
	typeof ScriptExecutionWorkflowPayload
>;

export type PinnedScriptExecutionWorkflowPayload = ScriptExecutionWorkflowPayload & {
	readonly startedAt: string;
};
