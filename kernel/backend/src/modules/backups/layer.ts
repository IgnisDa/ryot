import { Effect, Layer } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { ObjectStorageServiceLive, UploadServicesLive } from "#modules/assets/layer";
import { AutomationsRepository } from "#modules/automations/repository";
import { BackgroundWorkService } from "#modules/background-work/service";
import { DefinitionRepository } from "#modules/definitions/repository";
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { EventStreamWorkService } from "#modules/events/stream-work";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { NotificationsRepository } from "#modules/notifications/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginBackupRestoreLive } from "#modules/plugins/layer";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { RelationshipProjectionService } from "#modules/relationships/projections/service";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { BackupExportSnapshot } from "./export/snapshot";
import { ExportBackupWorkflowOperationsLive } from "./export/workflow";
import { BackupAccountCleanliness } from "./restore/account-cleanliness";
import {
	BackupRestoreAfterCommit,
	RestoreBackupWorkflowDefinitionsLive,
	RestoreBackupWorkflowOperationsLive,
} from "./restore/workflow";
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

const BackupRestoreAfterCommitLive = Layer.effect(
	BackupRestoreAfterCommit,
	Effect.gen(function* () {
		const streams = yield* EventStreamWorkService;
		const background = yield* BackgroundWorkService;
		const relationships = yield* RelationshipProjectionService;
		return {
			run: Effect.gen(function* () {
				yield* streams
					.reconcile()
					.pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("Restored projection reconciliation failed", cause),
						),
					);
				yield* background
					.recover()
					.pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("Restored background recovery failed", cause),
						),
					);
				yield* relationships
					.reconcile()
					.pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("Restored relationship projection reconciliation failed", cause),
						),
					);
			}),
		};
	}),
);

export const RestoreBackupWorkflowDefinitionsProvidedLive =
	RestoreBackupWorkflowDefinitionsLive.pipe(Layer.provide(BackupRestoreAfterCommitLive));
