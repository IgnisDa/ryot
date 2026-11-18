import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { IntegrationOperationScopeResolverProvidedLive } from "#modules/integrations/layer";
import { ScriptCalls } from "#modules/scripts/executions/calls";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";
import { ExecutableArtifacts } from "#modules/scripts/registry/executable-artifacts";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { UserCommandsLive } from "#modules/user-commands/layer";

import { PluginCatalogInvalidatorLive } from "../catalog/events";
import { PluginRuntimeResolverLive } from "../catalog/runtime-resolver";
import { PluginInstallationJobOperationsLive } from "../installations/job";
import { PluginInstallationRepository } from "../installations/repository";
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
			ScriptCalls.layer.pipe(Layer.provide(ExecutableArtifacts.layer)),
			UserCommandsLive,
		),
	),
);

export const PluginInstallationJobOperationsProvidedLive = PluginInstallationJobOperationsLive.pipe(
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
