import { Layer } from "effect";

import { ImportsServiceLive } from "#modules/imports/layer";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";

import { IntegrationOperationScopeResolverLive } from "./operation-scope-resolver-live";
import { IntegrationsRepository } from "./repository";
import { IntegrationsService } from "./service";

export const IntegrationsServiceLive = IntegrationsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ImportsServiceLive,
			IntegrationProviderCatalog.layer,
			IntegrationsRepository.layer,
		),
	),
);

export const IntegrationOperationScopeResolverProvidedLive =
	IntegrationOperationScopeResolverLive.pipe(Layer.provide(IntegrationsRepository.layer));
