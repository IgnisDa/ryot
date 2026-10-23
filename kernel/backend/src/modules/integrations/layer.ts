import { Layer } from "effect";

import { IngestionCaptures } from "#modules/imports/capture-service";
import {
	DataImportAdmissionLive,
	ImportsServiceLive,
	ImportWorkflowPinningLive,
	IngestionExecutionLive,
	IngestionRetirementLive,
} from "#modules/imports/layer";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { OAuthConnectionsServiceLive } from "#modules/oauth-connections/layer";
import { IntegrationProviderCatalog } from "#modules/plugins/catalog/integration-providers";
import { IngestionReadinessService } from "#modules/plugins/catalog/readiness-service";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import {
	SandboxPluginScriptResolverLive,
	ScriptExecutionServiceLive,
} from "#modules/scripts/layer";

import { IntegrationIngestion } from "./ingestion";
import { IntegrationOperationScopeResolverLive } from "./operation-scope-resolver-live";
import { IntegrationsRepository } from "./repository";
import { IntegrationsService } from "./service";
import { IntegrationSyncWorkflowDefinitionsLive } from "./sync-workflow-live";

export const IntegrationIngestionLive = IntegrationIngestion.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ImportsRepository.layer,
			IngestionCaptures.layer,
			ImportSourceStateStore.layer,
			ImportWorkflowPinningLive,
			IngestionExecutionLive,
			IngestionRetirementLive,
			IngestionReadinessService.layer,
			PluginInstallationRepository.layer,
			ScriptExecutionServiceLive,
			SandboxPluginScriptResolverLive,
		),
	),
);

export const IntegrationsServiceLive = IntegrationsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ImportsServiceLive,
			IntegrationProviderCatalog.layer,
			IntegrationsRepository.layer,
			OAuthConnectionsServiceLive,
			DataImportAdmissionLive,
			IngestionReadinessService.layer,
			IntegrationIngestionLive,
			ImportsRepository.layer,
			IngestionExecutionLive,
		),
	),
);

export const IntegrationOperationScopeResolverProvidedLive =
	IntegrationOperationScopeResolverLive.pipe(Layer.provide(IntegrationsRepository.layer));

export const IntegrationSyncWorkflowDefinitionsProvidedLive =
	IntegrationSyncWorkflowDefinitionsLive.pipe(Layer.provide(IntegrationsServiceLive));
