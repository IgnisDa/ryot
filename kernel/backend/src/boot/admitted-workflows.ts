import { Layer } from "effect";

import { UserBootstrapWorkflow } from "#modules/accounts/provisioning/workflow";
import { AutomationRunWorkflow } from "#modules/automations/run-workflow";
import { CollectionMembershipWorkflow } from "#modules/collections/collection-membership-workflow";
import { EntityImportWorkflow } from "#modules/entities/providers/entity-import-workflow";
import { ProviderEntityPopulationWorkflow } from "#modules/entities/providers/provider-entity-population-workflow";
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
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import { SandboxDurableHostServiceWorkflow } from "#modules/scripts/host/durable-dispatcher";

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
		CollectionMembershipWorkflow,
		UserBootstrapWorkflow,
	]),
);
