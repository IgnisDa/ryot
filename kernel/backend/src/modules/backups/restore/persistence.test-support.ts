import { Layer } from "effect";

import { PluginConfigRevisions } from "#modules/plugins/configuration/revisions";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { fakeDatabaseSession } from "#testing/effect";

import { BackupRestorePersistence } from "./persistence";

export const restorePersistenceWithDatabase = (db: object) =>
	Layer.effect(BackupRestorePersistence, BackupRestorePersistence.make).pipe(
		Layer.provide(
			Layer.mergeAll(
				fakeDatabaseSession(db),
				Layer.mock(PluginConfigRevisions)({}),
				Layer.mock(PluginInstallationRepository)({}),
				Layer.mock(SavedViewsRepository)({}),
			),
		),
	);
