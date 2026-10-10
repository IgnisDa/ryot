import { Layer } from "effect";

import { AuthServiceLive } from "#modules/auth/layer";
import { IntegrationOperationScopeResolverProvidedLive } from "#modules/integrations/layer";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";

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
			ScriptExecutionServiceLive,
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
				ScriptExecutionServiceLive,
				SandboxRepository.layer,
				SandboxWorkflowReferenceRepository.layer,
				PluginCatalogInvalidatorLive,
				PluginInstallationRepository.layer,
			),
		),
	);
