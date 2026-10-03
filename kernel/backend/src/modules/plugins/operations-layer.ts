import { Layer } from "effect";

import { AuthServiceLive } from "#modules/auth/layer";
import { IntegrationOperationScopeResolverProvidedLive } from "#modules/integrations/layer";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";

import { PluginCatalogInvalidatorLive } from "./catalog-events";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginInstallationWorkflowOperationsLive } from "./installation-workflow";
import { OperationsService } from "./operations-service";
import { PluginRepository } from "./repository";
import { PluginRuntimeResolverLive } from "./runtime-resolver";

export const OperationsServiceLive = OperationsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AuthServiceLive,
			PluginRepository.layer,
			PluginRuntimeResolverLive,
			SandboxExecutionServiceLive,
			IntegrationOperationScopeResolverProvidedLive,
		),
	),
);

export const PluginInstallationWorkflowOperationsProvidedLive =
	PluginInstallationWorkflowOperationsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				PluginRuntimeResolverLive,
				SandboxExecutionServiceLive,
				PluginCatalogInvalidatorLive,
				PluginInstallationRepository.layer,
			),
		),
	);
