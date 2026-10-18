import { Layer } from "effect";

import { UserBootstrapWorkflow } from "#modules/accounts/provisioning/workflow";
import { PolicyBatchWorkflow } from "#modules/automations/lifecycle/policy-batch";
import { AutomationRunWorkflow } from "#modules/automations/run-workflow";
import { BackgroundWorkWorkflow } from "#modules/background-work/service";
import { CollectionMembershipWorkflow } from "#modules/collections/collection-membership-workflow";
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
import { EventCreateWorkflow } from "#modules/events/event-create-workflow";
import { ProcessIngestionCaptureWorkflow } from "#modules/imports/capture-write-workflow";
import {
	ProcessDataImportSegmentWorkflow,
	ProcessDataImportWorkflow,
} from "#modules/imports/data-workflow";
import { ProcessGenericImportChunksWorkflow } from "#modules/imports/generic-import-workflow";
import { ProcessImportRunWorkflow } from "#modules/imports/import-run-workflow";
import { ProcessIntegrationRunWorkflow } from "#modules/integrations/integration-workflow";
import { IntegrationSyncWorkflow } from "#modules/integrations/sync-workflow";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import { SandboxDurableHostServiceWorkflow } from "#modules/scripts/host/durable-dispatcher";
import {
	UserCommandWorkflow,
	UserEntityPreparationWorkflow,
	UserRelationshipPreparationWorkflow,
} from "#modules/user-commands/workflow";

export const AdmittedWorkflowCatalogueLive = Layer.succeed(
	AdmittedWorkflowCatalogue,
	Object.freeze([
		EventCreateWorkflow,
		EntityImportWorkflow,
		ProviderEntityPopulationWorkflow,
		ProviderEntityPopulationAttemptWorkflow,
		TranslateEntityWorkflow,
		TranslateEntityAttemptWorkflow,
		ProviderRelatedPagesWorkflow,
		AutomationRunWorkflow,
		PolicyBatchWorkflow,
		ProcessImportRunWorkflow,
		ProcessDataImportWorkflow,
		ProcessDataImportSegmentWorkflow,
		ProcessGenericImportChunksWorkflow,
		ProcessIngestionCaptureWorkflow,
		ProcessIntegrationRunWorkflow,
		IntegrationSyncWorkflow,
		ScriptExecutionWorkflow,
		BackgroundWorkWorkflow,
		SandboxDurableHostServiceWorkflow,
		CollectionMembershipWorkflow,
		UserBootstrapWorkflow,
		UserCommandWorkflow,
		UserEntityPreparationWorkflow,
		UserRelationshipPreparationWorkflow,
	]),
);
