import { Layer } from "effect";

import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import {
	IntegrationPluginRevisionActivationLive,
	IntegrationsRepository,
} from "#modules/integrations/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";
import { SavedViewPluginReferencesProvidedLive } from "#modules/saved-views/layer";
import { ObjectStorageServiceLive, UploadServicesLive } from "#modules/uploads/layer";

import { PluginBackupRestore } from "./backup-restore";
import { SystemPluginBootstrap } from "./boot";
import {
	PluginCatalogInvalidator,
	PluginCatalogInvalidatorLive,
	PluginCatalogHub,
	PluginInvalidationSubscriber,
} from "./catalog-events";
import { PluginIngestionLock } from "./ingestion-lock";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginInstallationService } from "./installation-service";
import {
	PluginInstallationLifecycleDispatcher,
	PluginInstallationLifecycleDispatcherLive,
} from "./installation-workflow";
import { PluginRepository } from "./repository";
import { ScriptGarbageCollector } from "./script-garbage-collector";
import { PluginIngestionService } from "./service";
import { SystemPlugins } from "./system";

export const PluginRevisionActivationLive = IntegrationPluginRevisionActivationLive.pipe(
	Layer.provide(IntegrationsRepository.layer),
);

export const PluginIngestionLockLive = PluginIngestionLock.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			PluginRepository.layer,
			PluginInstallationRepository.layer,
			PluginRevisionActivationLive,
		),
	),
);

export const ScriptGarbageCollectorLive = ScriptGarbageCollector.layer.pipe(
	Layer.provide(Layer.merge(PluginRepository.layer, PackageCacheManager.layer)),
);

export const PluginInvalidationSubscriberLive = PluginInvalidationSubscriber.layer.pipe(
	Layer.provide(PluginCatalogHub.layer),
);

export const PluginIngestionServiceLive = PluginIngestionService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			PluginRevisionActivationLive,
			PluginRepository.layer,
			DefinitionRepository.layer,
			SystemPlugins.layer,
			PluginCatalogInvalidatorLive,
		),
	),
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
			UploadServicesLive,
			ObjectStorageServiceLive,
			PluginIngestionLockLive,
			SavedViewPluginReferencesProvidedLive,
		),
	),
);

export const PluginInstallationRuntimeLive = PluginInstallationService.layerRuntime.pipe(
	Layer.provide(
		Layer.mergeAll(
			installationRepositories,
			PluginInstallationLifecycleDispatcherLive,
			UploadServicesLive,
			ObjectStorageServiceLive,
			PluginIngestionLockLive,
			SavedViewPluginReferencesProvidedLive,
			PluginCatalogInvalidatorLive,
		),
	),
);

export const PluginBackupRestoreLive = PluginBackupRestore.layer.pipe(
	Layer.provide(
		Layer.mergeAll(PluginRepository.layer, DefinitionRepository.layer, PluginIngestionLockLive),
	),
);

export const SystemPluginIngestionLive = SystemPluginBootstrap.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			PluginIngestionServiceLive,
			PluginRepository.layer,
			DefinitionRepository.layer,
			ScriptGarbageCollectorLive,
			PluginInstallationMigrationLive,
			SystemPlugins.layer,
		),
	),
);
