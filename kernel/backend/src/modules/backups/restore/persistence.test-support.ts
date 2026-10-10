import { Layer } from "effect";

import { fakeDatabaseSession } from "#lib/test-utils/effect";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

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
