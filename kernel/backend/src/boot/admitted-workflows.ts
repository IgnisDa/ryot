import { Layer } from "effect";

import { EntityImportWorkflow } from "#modules/entities/providers/entity-import-workflow";
import { ProcessIngestionCaptureWorkflow } from "#modules/imports/capture-write-workflow";
import {
	ProcessDataImportSegmentWorkflow,
	ProcessDataImportWorkflow,
} from "#modules/imports/data-workflow";
import { ProcessGenericImportChunksWorkflow } from "#modules/imports/generic-import-workflow";
import { ProcessImportRunWorkflow } from "#modules/imports/import-run-workflow";
import { ProcessIntegrationRunWorkflow } from "#modules/integrations/integration-workflow";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";

export const AdmittedWorkflowCatalogueLive = Layer.succeed(
	AdmittedWorkflowCatalogue,
	Object.freeze([
		EntityImportWorkflow,
		ProcessImportRunWorkflow,
		ProcessDataImportWorkflow,
		ProcessDataImportSegmentWorkflow,
		ProcessGenericImportChunksWorkflow,
		ProcessIngestionCaptureWorkflow,
		ProcessIntegrationRunWorkflow,
		ScriptExecutionWorkflow,
	]),
);
