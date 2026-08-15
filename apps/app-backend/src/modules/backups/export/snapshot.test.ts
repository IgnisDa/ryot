import { tmpdir } from "node:os";

import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect, Layer } from "effect";

import { databaseLayer } from "#lib/test-utils/effect";
import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository } from "#modules/events/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";

import {
	BackupExportSnapshot,
	collectManagedAssetLocators,
	requireV1NotificationMetadataSchema,
} from "./snapshot";

it("does not archive managed assets stored in schema-declared secret fields", () => {
	const propertiesSchema: AppSchema = {
		fields: {
			publicAsset: {
				type: "object",
				properties: {},
				label: "Public asset",
				description: "Public asset",
				validation: { asset: true },
			},
			secretAsset: {
				secret: true,
				type: "object",
				properties: {},
				label: "Secret asset",
				validation: { asset: true },
				description: "Secret asset",
			},
		},
	};
	expect(
		collectManagedAssetLocators([
			{
				propertiesSchema,
				properties: {
					publicAsset: { type: "local", key: "permanent/public.bin" },
					secretAsset: { type: "local", key: "permanent/secret.bin" },
				},
			},
		]),
	).toEqual([{ type: "local", key: "permanent/public.bin" }]);
});

it.effect("rejects non-null notification metadata without its signal schema", () =>
	Effect.gen(function* () {
		const error = yield* requireV1NotificationMetadataSchema(
			{ isActive: false, metadata: { token: "secret" }, signalSchemaSlug: "missing.signal" },
			undefined,
		).pipe(Effect.flip);
		expect(error.message).toContain("unavailable signal schema 'missing.signal'");
		expect(
			yield* requireV1NotificationMetadataSchema(
				{ isActive: false, metadata: null, signalSchemaSlug: "missing.signal" },
				undefined,
			),
		).toBeUndefined();
	}),
);

const userId = UserId.make("user-1");

const installationRow = (input: {
	readonly id: string;
	readonly pluginId: string;
	readonly pluginSlug: string;
	readonly pluginScope: "system" | "user";
}) => ({
	...input,
	userId,
	config: {},
	sortOrder: 0,
	health: "ready" as const,
	isDisabled: false,
	healthReason: null,
	createdAt: new Date("2026-08-24T12:00:00.000Z"),
	updatedAt: new Date("2026-08-24T12:00:00.000Z"),
});

it.effect("exports only system plugin installation state", () => {
	const eventsPath = `${tmpdir()}/backup-export-plugin-state-${crypto.randomUUID()}.ndjson`;
	const systemInstallation = installationRow({
		pluginScope: "system",
		id: "installation-system",
		pluginSlug: "system-plugin",
		pluginId: "system-plugin-id",
	});
	const privateInstallation = installationRow({
		pluginScope: "user",
		id: "installation-private",
		pluginSlug: "private-plugin",
		pluginId: "private-plugin-id",
	});
	const layer = BackupExportSnapshot.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				BunFileSystem.layer,
				Layer.succeed(DefinitionRegistry, makeDefinitionRegistry()),
				Layer.mock(AuthRepository, {
					getPortableProfile: () => Effect.succeed({ name: "Owner", image: null, preferences: {} }),
				}),
				Layer.mock(EventsRepository, { listUserEventsForBackup: () => Effect.succeed([]) }),
				Layer.mock(EntitiesRepository, {
					getByIdsForUser: () => Effect.succeed([]),
					listUserEntitiesForBackup: () => Effect.succeed([]),
					listGlobalEntitiesByIdsForBackup: () => Effect.succeed([]),
					listReferencedGlobalEntitiesForBackup: () => Effect.succeed([]),
				}),
				Layer.mock(SavedViewsRepository, { listForBackup: () => Effect.succeed([]) }),
				Layer.mock(TranslationsRepository, { listForBackup: () => Effect.succeed([]) }),
				Layer.mock(RelationshipsRepository, {
					listUserRelationshipsForBackup: () => Effect.succeed([]),
				}),
				Layer.mock(AutomationsRepository, {
					listNotificationSubscriptionsForBackup: () => Effect.succeed([]),
				}),
				Layer.mock(ManagedAssetsService, {
					verifyManagedAssetOwnership: () => Effect.succeed([]),
				}),
				Layer.mock(PluginRepository, {
					listPortablePluginMetadata: () =>
						Effect.succeed([
							{
								version: "1.0.0",
								slug: "system-plugin",
								signalSchemaSlugs: [],
								id: "system-plugin-id",
								relationshipSchemaSlugs: [],
								configSchema: { fields: {}, unknownKeys: "strict" as const },
								metadata: {
									icon: "box",
									version: "1.0.0",
									name: "System Plugin",
									slug: "system-plugin",
									description: "System plugin",
								},
							},
						]),
				}),
				Layer.mock(PluginInstallationRepository, {
					listForUser: () => Effect.succeed([systemInstallation, privateInstallation]),
					listSystemForUser: () => Effect.succeed([systemInstallation]),
				}),
			),
		),
	);
	return Effect.gen(function* () {
		const snapshot = yield* BackupExportSnapshot;
		const prepared = yield* snapshot.prepareExportSnapshot(userId, eventsPath);
		expect(prepared.records.pluginState.map(({ pluginSlug }) => pluginSlug)).toEqual([
			"system-plugin",
		]);
		expect(prepared.requiredPlugins).toEqual([{ slug: "system-plugin", version: "1.0.0" }]);
	}).pipe(Effect.provide(Layer.mergeAll(layer, databaseLayer)));
});
