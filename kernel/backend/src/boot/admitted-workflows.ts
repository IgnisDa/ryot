import { Layer } from "effect";

import { AutomationRunWorkflow } from "#modules/automations/run-workflow";
import { AddEntityToCollectionWorkflow } from "#modules/collections/add-entity-to-collection-workflow";
import { EventCreateWorkflow } from "#modules/events/event-create-workflow";
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
import { SandboxDurableHostServiceWorkflow } from "#modules/sandbox/durable-host-dispatcher";
import { SandboxScriptWorkflow } from "#modules/sandbox/sandbox-script-workflow";
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
		ProcessIntegrationRunWorkflow,
		IntegrationSyncWorkflow,
		SandboxScriptWorkflow,
		SandboxDurableHostServiceWorkflow,
		AddEntityToCollectionWorkflow,
		UserBootstrapWorkflow,
	]),
);
