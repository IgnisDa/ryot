import { Layer } from "effect";

import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { NotificationsRepository } from "#modules/notifications/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginBackupRestoreLive } from "#modules/plugins/layer";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { ObjectStorageServiceLive, UploadServicesLive } from "#modules/uploads/layer";

import { BackupExportSnapshot } from "./export/snapshot";
import { ExportBackupWorkflowOperationsLive } from "./export/workflow";
import { BackupAccountCleanliness } from "./restore/account-cleanliness";
import { RestoreBackupWorkflowOperationsLive } from "./restore/workflow";
import { BackupRestoreWriter } from "./restore/writer";
import { BackupsRepository } from "./runs/repository";
import { BackupsService } from "./service";

export const BackupExportSnapshotLive = BackupExportSnapshot.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AuthRepository.layer,
			EventsRepository.layer,
			PluginRepository.layer,
			EntitiesRepositoryLive,
			UploadServicesLive,
			DefinitionRepository.layer,
			SavedViewsRepository.layer,
			AutomationsRepository.layer,
			IntegrationsRepository.layer,
			TranslationsRepository.layer,
			RelationshipsRepository.layer,
			PluginInstallationRepository.layer,
			PluginRuntimeResolverLive,
		),
	),
);

export const BackupAccountCleanlinessLive = BackupAccountCleanliness.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AuthRepository.layer,
			EventsRepository.layer,
			EntitiesRepositoryLive,
			UploadServicesLive,
			DefinitionRepository.layer,
			SavedViewsRepository.layer,
			AutomationsRepository.layer,
			IntegrationsRepository.layer,
			RelationshipsRepository.layer,
			NotificationsRepository.layer,
			PluginInstallationRepository.layer,
		),
	),
);

export const BackupRestoreWriterLive = BackupRestoreWriter.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			PluginRepository.layer,
			EntitiesRepositoryLive,
			SavedViewsRepository.layer,
			AutomationsRepository.layer,
			PluginInstallationRepository.layer,
		),
	),
);

export const BackupServicesLive = Layer.mergeAll(
	BackupRestoreWriterLive,
	PluginBackupRestoreLive,
	BackupExportSnapshotLive,
	BackupAccountCleanlinessLive,
	BackupsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				BackupsRepository.layer,
				BackupAccountCleanlinessLive,
				ObjectStorageServiceLive,
			),
		),
	),
);

export const BackupWorkflowOperationsLive = Layer.merge(
	ExportBackupWorkflowOperationsLive.pipe(
		Layer.provide(
			Layer.mergeAll(BackupsRepository.layer, BackupExportSnapshotLive, ObjectStorageServiceLive),
		),
	),
	RestoreBackupWorkflowOperationsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				BackupsRepository.layer,
				BackupRestoreWriterLive,
				PluginBackupRestoreLive,
				UploadServicesLive,
				ObjectStorageServiceLive,
				BackupAccountCleanlinessLive,
			),
		),
	),
);
