import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { ScriptChangesLive } from "#modules/changes/layer";
import { IntegrationOperationScopeResolverProvidedLive } from "#modules/integrations/layer";
import { ScriptCalls } from "#modules/scripts/executions/calls";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";

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
			SandboxRepository.layer,
			IntegrationOperationScopeResolverProvidedLive,
			ScriptCalls.layer,
			ScriptChangesLive,
		),
	),
);

export const PluginInstallationJobOperationsProvidedLive = PluginInstallationJobOperationsLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			PluginRuntimeResolverLive,
			ScriptCalls.layer,
			ScriptChangesLive,
			SandboxRepository.layer,
			SandboxWorkflowReferenceRepository.layer,
			PluginCatalogInvalidatorLive,
			PluginInstallationRepository.layer,
		),
	),
);
