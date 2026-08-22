import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { PluginCatalogInvalidator } from "./catalog-events";
import { PluginIngestionLock } from "./ingestion-lock";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginInstallationService } from "./installation-service";
import {
	PluginInstallationLifecycleDispatcher,
	PluginInstallationLifecycleDispatcherLive,
} from "./installation-workflow";
import { PluginRepository } from "./repository";

export const PluginIngestionLockLive = PluginIngestionLock.layer.pipe(
	Layer.provide(Layer.mergeAll(PluginRepository.layer, PluginInstallationRepository.layer)),
);

const installationRepositories = Layer.mergeAll(
	DefinitionRepository.layer,
	PluginRepository.layer,
	PluginInstallationRepository.layer,
	SandboxWorkflowReferenceRepository.layer,
);

export const PluginInstallationMigrationLive = PluginInstallationService.layerMigration.pipe(
	Layer.provide(
		Layer.mergeAll(
			installationRepositories,
			PluginCatalogInvalidator.layer,
			PluginInstallationLifecycleDispatcher.layer,
		),
	),
);

export const PluginInstallationRuntimeLive = PluginInstallationService.layerRuntime.pipe(
	Layer.provide(Layer.merge(installationRepositories, PluginInstallationLifecycleDispatcherLive)),
);
