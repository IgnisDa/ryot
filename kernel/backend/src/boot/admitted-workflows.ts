import { Layer } from "effect";

import { AutomationRunWorkflow } from "#modules/automations/run-workflow";
import { BackgroundWorkWorkflow } from "#modules/background-work/service";
import {
	TranslateEntityAttemptWorkflow,
	TranslateEntityWorkflow,
} from "#modules/entities/localization/entity-translation-workflow";
import { EntityImportWorkflow } from "#modules/entities/providers/entity-import-workflow";
import {
	ProviderEntityPopulationAttemptWorkflow,
	ProviderEntityPopulationWorkflow,
	ProviderRelatedPagesWorkflow,
} from "#modules/entities/providers/provider-entity-population-workflow";
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
import { SandboxDurableHostServiceWorkflow } from "#modules/scripts/host/durable-dispatcher";

export const AdmittedWorkflowCatalogueLive = Layer.succeed(
	AdmittedWorkflowCatalogue,
	Object.freeze([
		EntityImportWorkflow,
		ProviderEntityPopulationWorkflow,
		ProviderEntityPopulationAttemptWorkflow,
		TranslateEntityWorkflow,
		TranslateEntityAttemptWorkflow,
		ProviderRelatedPagesWorkflow,
		AutomationRunWorkflow,
		ProcessImportRunWorkflow,
		ProcessDataImportWorkflow,
		ProcessDataImportSegmentWorkflow,
		ProcessGenericImportChunksWorkflow,
		ProcessIngestionCaptureWorkflow,
		ProcessIntegrationRunWorkflow,
		ScriptExecutionWorkflow,
		BackgroundWorkWorkflow,
		SandboxDurableHostServiceWorkflow,
	]),
);
