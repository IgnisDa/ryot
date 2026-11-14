import { Layer } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { ObjectStorageServiceLive, UploadServicesLive } from "#modules/assets/layer";
import { AutomationsRepository } from "#modules/automations/repository";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginBackupRestoreLive } from "#modules/plugins/layer";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { ExportBackupJobLive, ExportBackupOperationsLive } from "./export/job";
import { BackupExportSnapshot } from "./export/snapshot";
import { BackupAccountCleanliness } from "./restore/account-cleanliness";
import { RestoreBackupJobLive, RestoreBackupOperationsLive } from "./restore/job";
import { BackupRestoreWriter } from "./restore/writer";
import { BackupsRepository } from "./runs/repository";
import { BackupsService } from "./service";
import { BackupStaging } from "./staging";

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
			DefinitionRepository.layer,
			SavedViewsRepository.layer,
			AutomationsRepository.layer,
			PluginInstallationRepository.layer,
		),
	),
);

export const BackupRestoreWriterLive = BackupRestoreWriter.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			PluginRepository.layer,
			BackupStaging.layer,
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
				BackupStaging.layer,
				BackupAccountCleanlinessLive,
				ObjectStorageServiceLive,
			),
		),
	),
);

export const BackupJobsLive = Layer.merge(
	ExportBackupJobLive.pipe(
		Layer.provide(ExportBackupOperationsLive),
		Layer.provide(
			Layer.mergeAll(
				BackupsRepository.layer,
				BackupStaging.layer,
				BackupExportSnapshotLive,
				ObjectStorageServiceLive,
			),
		),
	),
	RestoreBackupJobLive.pipe(
		Layer.provide(RestoreBackupOperationsLive),
		Layer.provide(
			Layer.mergeAll(
				BackupsRepository.layer,
				BackupStaging.layer,
				BackupRestoreWriterLive,
				PluginBackupRestoreLive,
				UploadServicesLive,
				ObjectStorageServiceLive,
				BackupAccountCleanlinessLive,
			),
		),
	),
);
