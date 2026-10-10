import { Layer } from "effect";

import { IngestionCaptures } from "#modules/imports/capture-service";
import {
	DataImportAdmissionLive,
	ImportsServiceLive,
	IngestionExecutionLive,
	IngestionRetirementLive,
	ImportWorkflowPinningLive,
} from "#modules/imports/layer";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { OAuthConnectionsServiceLive } from "#modules/oauth-connections/layer";
import { IngestionReadinessService } from "#modules/plugins/ingestion-readiness-service";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import {
	SandboxExecutionServiceLive,
	SandboxPluginScriptResolverLive,
} from "#modules/sandbox/layer";

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
			SandboxExecutionServiceLive,
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
