import { expect, layer } from "@effect/vitest";
import { SignalSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { assert, describe } from "vitest";

import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import {
	installRevisionPackage,
	revisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/revision.test-support";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { AutomationsRepository } from "./repository";

describe("Notification configuration PostgreSQL", () => {
	layer(
		Layer.merge(
			AutomationsRepository.layer,
			BackupRestorePersistence.layer.pipe(Layer.provide(SavedViewsRepository.layer)),
		).pipe(Layer.provideMerge(revisionDatabaseLayer)),
	)((test) => {
		test.effect(
			"preserves inactive configuration and falsy backup metadata, with exact user and plugin scope",
			() =>
				Effect.gen(function* () {
					const repository = yield* AutomationsRepository;
					const persistence = yield* BackupRestorePersistence;
					const installed = yield* installRevisionPackage(revisionPackage());
					const userId = UserId.make("owner");
					const other = UserId.make("recipient");
					const signalSchemaSlug = SignalSchemaSlug.make("fixture.signal");
					const preference = {
						userId,
						metadata: false,
						isActive: false,
						signalSchemaSlug,
						signalSchemaPluginId: installed.pluginId,
					};
					const inserted = yield* repository.insertNotificationSubscription(preference);
					assert(inserted);
					const state = yield* repository.findNotificationSubscription({
						userId,
						ruleId: inserted.id,
					});
					assert(state);
					expect(inserted).toEqual({ id: state.id });
					expect(
						yield* repository.insertNotificationSubscription({
							...preference,
							isActive: true,
							metadata: null,
						}),
					).toBeNull();
					expect(yield* repository.listNotificationSubscriptionsForBackup(userId)).toEqual([state]);
					expect(state.metadata).toBe(false);
					expect(
						yield* repository.findNotificationSubscription({ userId: other, ruleId: state.id }),
					).toBeNull();
					expect(
						yield* repository.setNotificationSubscriptionActive({
							userId: other,
							isActive: true,
							ruleId: state.id,
						}),
					).toBeNull();
					expect(
						yield* repository.deleteNotificationSubscription({ userId: other, ruleId: state.id }),
					).toBeNull();
					expect(
						yield* persistence.restoreNotificationSubscription({
							...preference,
							isActive: true,
							signalSchemaPluginId: null,
						}),
					).toBe(false);
					expect(
						yield* persistence.restoreNotificationSubscription({ ...preference, isActive: true }),
					).toBe(true);
					expect(
						yield* repository.listActiveNotificationSubscriptions({
							userId,
							signalSchemaSlug,
							signalSchemaPluginId: null,
						}),
					).toEqual([]);
					expect(
						(yield* repository.listActiveNotificationSubscriptions(preference)).map(({ id }) => id),
					).toEqual([state.id]);
					expect(yield* repository.listNotificationSubscriptionsForBackup(other)).toEqual([]);
				}),
		);
	});
});
