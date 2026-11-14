import { Layer } from "effect";

import { AssistantTurnWorkflow } from "#modules/assistant/workflow";
import { ProcessImportRunWorkflow } from "#modules/imports/import-run-workflow";
import { ProcessIntegrationRunWorkflow } from "#modules/integrations/integration-workflow";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";

export const AdmittedWorkflowCatalogueLive = Layer.succeed(
	AdmittedWorkflowCatalogue,
	Object.freeze([
		AssistantTurnWorkflow,
		ProcessImportRunWorkflow,
		ProcessIntegrationRunWorkflow,
		ScriptExecutionWorkflow,
	]),
);
