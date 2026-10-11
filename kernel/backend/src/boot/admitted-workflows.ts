import { Layer } from "effect";

import { AutomationRunWorkflow } from "#modules/automations/run-workflow";
import { AddEntityToCollectionWorkflow } from "#modules/collections/add-entity-to-collection-workflow";
import { EventCreateWorkflow } from "#modules/events/event-create-workflow";
import { ProcessIngestionCaptureWorkflow } from "#modules/imports/capture-write-workflow";
import {
	ProcessDataImportWorkflow,
	ProcessDataImportSegmentWorkflow,
} from "#modules/imports/data-workflow";
import { ProcessGenericImportChunksWorkflow } from "#modules/imports/generic-import-workflow";
import { ProcessImportRunWorkflow } from "#modules/imports/import-run-workflow";
import { ProcessIntegrationRunWorkflow } from "#modules/integrations/integration-workflow";
import { IntegrationSyncWorkflow } from "#modules/integrations/sync-workflow";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";
import { EntityImportWorkflow } from "#modules/provider-entities/entity-import-workflow";
import { ProviderEntityPopulationWorkflow } from "#modules/provider-entities/provider-entity-population-workflow";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import { SandboxDurableHostServiceWorkflow } from "#modules/scripts/host/durable-dispatcher";
import { UserBootstrapWorkflow } from "#modules/user-bootstrap/workflow";

export const AdmittedWorkflowCatalogueLive = Layer.succeed(
	AdmittedWorkflowCatalogue,
	Object.freeze([
		EventCreateWorkflow,
		EntityImportWorkflow,
		ProviderEntityPopulationWorkflow,
		AutomationRunWorkflow,
		ProcessImportRunWorkflow,
		ProcessDataImportWorkflow,
		ProcessDataImportSegmentWorkflow,
		ProcessGenericImportChunksWorkflow,
		ProcessIngestionCaptureWorkflow,
		ProcessIntegrationRunWorkflow,
		IntegrationSyncWorkflow,
		ScriptExecutionWorkflow,
		SandboxDurableHostServiceWorkflow,
		AddEntityToCollectionWorkflow,
		UserBootstrapWorkflow,
	]),
);
