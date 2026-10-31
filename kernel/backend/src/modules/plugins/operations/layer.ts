import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { IntegrationOperationScopeResolverProvidedLive } from "#modules/integrations/layer";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";

import { PluginCatalogInvalidatorLive } from "../catalog/events";
import { PluginRuntimeResolverLive } from "../catalog/runtime-resolver";
import { PluginInstallationRepository } from "../installations/repository";
import { PluginInstallationWorkflowOperationsLive } from "../installations/workflow";
import { PluginRepository } from "../packages/repository";
import { OperationsService } from "./service";

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
