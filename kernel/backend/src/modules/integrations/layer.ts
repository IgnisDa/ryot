import { Layer } from "effect";

import { ImportsServiceLive } from "#modules/imports/layer";
import { OAuthConnectionsServiceLive } from "#modules/oauth-connections/layer";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";

import { IntegrationOperationScopeResolverLive } from "./operation-scope-resolver-live";
import { IntegrationsRepository } from "./repository";
import { IntegrationsService } from "./service";
import { IntegrationSyncWorkflowDefinitionsLive } from "./sync-workflow-live";

export const IntegrationsServiceLive = IntegrationsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ImportsServiceLive,
			IntegrationProviderCatalog.layer,
			IntegrationsRepository.layer,
			OAuthConnectionsServiceLive,
		),
	),
);

export const IntegrationOperationScopeResolverProvidedLive =
	IntegrationOperationScopeResolverLive.pipe(Layer.provide(IntegrationsRepository.layer));

export const IntegrationSyncWorkflowDefinitionsProvidedLive =
	IntegrationSyncWorkflowDefinitionsLive.pipe(Layer.provide(IntegrationsServiceLive));
