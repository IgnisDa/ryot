import { Layer } from "effect";

import { AuthServiceLive } from "#modules/auth/layer";
import { ClientSurfaceMaterializerLive } from "#modules/client-pages/layer";
import { IntegrationOperationScopeResolverProvidedLive } from "#modules/integrations/layer";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";

import { PluginInstallationRepository } from "./installation-repository";
import { PluginInstallationWorkflowOperationsLive } from "./installation-workflow";
import { MaterializingPluginCatalogInvalidatorLive } from "./layer";
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
				MaterializingPluginCatalogInvalidatorLive,
				ClientSurfaceMaterializerLive,
				PluginInstallationRepository.layer,
			),
		),
	);
