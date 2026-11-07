import { implementWorkflow } from "#platform/workflow/scope";

import { runScriptExecutionWorkflow, ScriptExecutionWorkflow } from "./workflow";

export const SandboxWorkflowDefinitionsLive = implementWorkflow(
	ScriptExecutionWorkflow,
	runScriptExecutionWorkflow,
);
