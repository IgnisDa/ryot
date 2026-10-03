import { Layer } from "effect";

import { AuthServiceLive } from "#modules/auth/layer";
import { IntegrationOperationScopeResolverProvidedLive } from "#modules/integrations/layer";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

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
			PluginInstallationRepository.layer,
			PluginRuntimeResolverLive,
			SandboxExecutionServiceLive,
			SandboxRepository.layer,
			SandboxWorkflowReferenceRepository.layer,
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
				SandboxRepository.layer,
				SandboxWorkflowReferenceRepository.layer,
				PluginCatalogInvalidatorLive,
				PluginInstallationRepository.layer,
			),
		),
	);
