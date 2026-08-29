import { Effect, Layer } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { BackupRestorePersistence } from "./persistence";

export const restorePersistenceWithDatabase = (db: object) =>
	Layer.effect(BackupRestorePersistence, BackupRestorePersistence.make).pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.mock(DatabaseSession)({
					current: Effect.succeed(Object.assign(Object.create(null), db)),
				}),
				Layer.mock(PluginConfigRevisions)({}),
				Layer.mock(PluginInstallationRepository)({}),
				Layer.mock(SavedViewsRepository)({}),
			),
		),
	);
