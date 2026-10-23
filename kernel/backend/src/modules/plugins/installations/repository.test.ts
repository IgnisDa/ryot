import { expect, layer } from "@effect/vitest";
import { type PluginPackageId, SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import { eq, isNull } from "drizzle-orm";
import { Context, Effect, Layer, Ref } from "effect";
import { assert, describe } from "vitest";

import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { PluginIngestionLock } from "../packages/ingestion-lock";
import { PluginRepository } from "../packages/repository";
import { PluginRevisionActivation } from "../packages/revision-activation";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "../packages/revision.test-support";
import { SystemPlugins } from "../packages/system";
import { fixtureManifest } from "../test-support";
import { PluginInstallationRepository } from "./repository";

const owner = UserId.make("owner");
const timestamp = new Date("2026-08-23T12:00:00.000Z");

const configuredPackage = (version: string, endpointSecret: boolean) => {
	const plugin = revisionPackage(
		"notes",
		version,
		"notes-entity",
		fixtureManifest().metadata.packageId,
	);
	return {
		...plugin,
		manifest: {
			...plugin.manifest,
			configSchema: {
				unknownKeys: "strict" as const,
				fields: {
					token: { secret: true, type: "string", label: "Token", description: "Private token" },
					endpoint: {
						type: "string",
						label: "Endpoint",
						description: "Server URL",
						...(endpointSecret ? { secret: true } : {}),
					},
				},
			},
		},
	} satisfies typeof plugin;
};

const clientProjection = (id: string) =>
	Effect.gen(function* () {
		const [row] = yield* (yield* DatabaseSession).run((db) =>
			db
				.select({
					clientConfig: tables.pluginInstallation.clientConfig,
					configuredSecretPaths: tables.pluginInstallation.configuredSecretPaths,
				})
				.from(tables.pluginInstallation)
				.where(eq(tables.pluginInstallation.id, id)),
		);
		return row;
	});

class RecordedActivations extends Context.Service<
	RecordedActivations,
	{ readonly activated: Effect.Effect<ReadonlyArray<string>> }
>()("test/RecordedActivations") {}

const recordedActivationsLayer = Layer.effectContext(
	Effect.gen(function* () {
		const activated = yield* Ref.make<ReadonlyArray<string>>([]);
		return Context.make(PluginRevisionActivation, {
			activated: (pluginId) => Ref.update(activated, (all) => [...all, pluginId]),
		}).pipe(Context.add(RecordedActivations, { activated: Ref.get(activated) }));
	}),
);

describe("installation revision persistence", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect("quarantines exact private claims without replacing records or configuration", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const plugins = yield* PluginRepository;
				const installations = yield* PluginInstallationRepository;
				const plugin = revisionPackage("same-name");
				const privateInstallation = yield* session.transaction(
					Effect.gen(function* () {
						yield* plugins.lockIngestion();
						const pluginId = yield* plugins.persist(plugin, { scope: "user", ownerId: owner });
						return yield* installations.create({
							pluginId,
							config: {},
							sortOrder: 0,
							userId: owner,
							health: "ready",
							isHidden: false,
						});
					}),
				);
				assert(privateInstallation);
				const quarantined = yield* session.transaction(
					Effect.gen(function* () {
						yield* plugins.lockIngestion();
						yield* plugins.persist(plugin, { ownerId: null, scope: "system" });
						return yield* installations.quarantinePackageIdentityConflicts(
							plugin.manifest.metadata.packageId,
						);
					}),
				);
				expect(quarantined).toEqual([
					{ userId: owner, id: privateInstallation.id, pluginId: privateInstallation.pluginId },
				]);
				const retained = yield* installations.findByUserAndPlugin(
					owner,
					privateInstallation.pluginId,
				);
				expect(retained).toMatchObject({
					uninstalledAt: null,
					health: "incompatible",
					id: privateInstallation.id,
					config: privateInstallation.config,
					incompatibilityReason: "package-identity-conflict",
					activeConfigRevisionId: privateInstallation.activeConfigRevisionId,
				});
				const privatePlugin = yield* plugins.findPrivateByIdForUser(
					privateInstallation.pluginId,
					owner,
				);
				assert(privatePlugin);
				expect(
					yield* session.transaction(
						installations.updateHealthForActivation({
							health: "ready",
							healthReason: null,
							id: privateInstallation.id,
							activationId: privatePlugin.activationId,
						}),
					),
				).toBe(false);
				const recoveredActivation = yield* session.transaction(
					Effect.gen(function* () {
						yield* plugins.lockIngestion();
						const system = yield* plugins.findActiveSystemPluginByPackageId(
							plugin.manifest.metadata.packageId,
						);
						assert(system);
						yield* plugins.deactivate(system.id);
						const activationId = yield* plugins.rotatePrivateActivation({
							ownerId: owner,
							pluginId: privatePlugin.id,
							expectedActivationId: privatePlugin.activationId,
						});
						yield* installations.updateHealth({
							healthReason: null,
							health: "installing",
							id: privateInstallation.id,
						});
						return activationId;
					}),
				);
				expect(recoveredActivation).not.toBe(privatePlugin.activationId);
				expect(
					yield* session.transaction(
						installations.updateHealthForActivation({
							health: "ready",
							healthReason: null,
							id: privateInstallation.id,
							activationId: privatePlugin.activationId,
						}),
					),
				).toBe(false);
				expect((yield* installations.findById(privateInstallation.id))?.isInitialized).toBe(false);
				expect(
					yield* session.transaction(
						installations.updateHealthForActivation({
							health: "ready",
							healthReason: null,
							id: privateInstallation.id,
							activationId: recoveredActivation,
						}),
					),
				).toBe(true);
				expect(yield* installations.findByUserAndPlugin(owner, privatePlugin.id)).toMatchObject({
					health: "ready",
					isInitialized: true,
					activeConfigRevisionId: privateInstallation.activeConfigRevisionId,
				});
			}),
		);
		test.effect(
			"marks system initialization from no-entry proof or guarded successful bootstrap completion",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const plugins = yield* PluginRepository;
					const installations = yield* PluginInstallationRepository;
					const empty = revisionPackage("no-bootstrap");
					const base = revisionPackage("with-bootstrap");
					const seeded = {
						...base,
						manifest: {
							...base.manifest,
							userBootstrap: [
								{ slug: "seed", description: "Seed owner data", scriptSlug: "with-bootstrap.task" },
							],
						},
					};
					const ids = yield* session.transaction(
						Effect.gen(function* () {
							yield* plugins.lockIngestion();
							const pluginIds = yield* Effect.forEach([empty, seeded], (plugin) =>
								plugins.persist(plugin, { ownerId: null, scope: "system" }),
							);
							yield* installations.provisionSystemInstallationsForUser(owner);
							return pluginIds;
						}),
					);
					const [emptyId, seededId] = ids;
					assert(emptyId);
					assert(seededId);
					const noEntries = yield* installations.findByUserAndPlugin(owner, emptyId);
					const hasEntries = yield* installations.findByUserAndPlugin(owner, seededId);
					expect(noEntries).toMatchObject({ health: "ready", isInitialized: true });
					expect(hasEntries).toMatchObject({ health: "ready", isInitialized: false });
					assert(hasEntries);
					const plugin = yield* plugins.findActiveSystemPluginById(seededId);
					assert(plugin);
					expect(
						yield* session.transaction(
							installations.completeSystemInitialization({
								userId: owner,
								installationId: hasEntries.id,
								activationId: "old-activation",
							}),
						),
					).toBe(false);
					expect(
						yield* session.transaction(
							installations.completeSystemInitialization({
								userId: owner,
								installationId: hasEntries.id,
								activationId: plugin.activationId,
							}),
						),
					).toBe(true);
					expect((yield* installations.findById(hasEntries.id))?.isInitialized).toBe(true);
				}),
		);
		test.effect("completes no-entry initializations only for matching activation pairs", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const plugins = yield* PluginRepository;
				const installations = yield* PluginInstallationRepository;
				const [firstId, secondId] = yield* session.transaction(
					Effect.gen(function* () {
						yield* plugins.lockIngestion();
						const pluginIds = yield* Effect.forEach(
							[revisionPackage("first-empty"), revisionPackage("second-empty")],
							(plugin) => plugins.persist(plugin, { ownerId: null, scope: "system" }),
						);
						yield* installations.provisionSystemInstallationsForUser(owner);
						yield* session.run((db) =>
							db
								.update(tables.pluginInstallation)
								.set({ health: "installing", isInitialized: false })
								.where(eq(tables.pluginInstallation.userId, owner)),
						);
						return pluginIds;
					}),
				);
				assert(firstId && secondId);
				const first = yield* installations.findByUserAndPlugin(owner, firstId);
				const second = yield* installations.findByUserAndPlugin(owner, secondId);
				const firstPlugin = yield* plugins.findActiveSystemPluginById(firstId);
				const secondPlugin = yield* plugins.findActiveSystemPluginById(secondId);
				assert(first && second && firstPlugin && secondPlugin);
				expect(
					yield* session.transaction(
						installations.completeNoEntryInitializations({
							userId: owner,
							installations: [
								{ installationId: first.id, activationId: secondPlugin.activationId },
								{ installationId: second.id, activationId: firstPlugin.activationId },
							],
						}),
					),
				).toEqual([]);
				expect(
					yield* session.transaction(
						installations.completeNoEntryInitializations({
							userId: owner,
							installations: [{ installationId: first.id, activationId: firstPlugin.activationId }],
						}),
					),
				).toEqual([first.id]);
				expect(yield* installations.findById(first.id)).toMatchObject({
					health: "ready",
					isInitialized: true,
				});
				expect(yield* installations.findById(second.id)).toMatchObject({
					health: "installing",
					isInitialized: false,
				});
			}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"resolves kernel and plugin saved-view renderers without custom renderer state",
			() =>
				Effect.gen(function* () {
					const repository = yield* PluginInstallationRepository;
					const session = yield* DatabaseSession;
					const renderers = [
						{ kind: "kernel", name: "entity-browser" },
						{ kind: "plugin", exportName: "home", pluginId: "plugin-id" },
					] as const;
					for (const [index, renderer] of renderers.entries()) {
						const id = `saved-view-${index}`;
						yield* session.run((db) =>
							db
								.insert(tables.savedView)
								.values({
									id,
									slug: id,
									name: id,
									renderer,
									icon: "view",
									settings: {},
									userId: owner,
								}),
						);
						expect(
							yield* repository.findHomeSavedView(owner, {
								kind: "custom",
								savedViewId: SavedViewId.make(id),
							}),
						).toEqual({ view: { renderer, isHidden: false } });
					}
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("scopes home-view writes to the owning user", () =>
			Effect.gen(function* () {
				const repository = yield* PluginInstallationRepository;
				const installed = yield* installRevisionPackage(revisionPackage("notes"), owner);
				expect(
					yield* repository.setHomeSavedView(
						UserId.make("recipient"),
						installed.installation.id,
						null,
					),
				).toBe(false);
				expect(yield* repository.setHomeSavedView(owner, installed.installation.id, null)).toBe(
					true,
				);
			}),
		);
	});

	layer(
		BackupRestorePersistence.layer.pipe(
			Layer.provide(SavedViewsRepository.layer),
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect(
			"restores portable private config as encrypted revisions and preserves destination config when requested",
			() =>
				Effect.gen(function* () {
					const repository = yield* PluginInstallationRepository;
					const session = yield* DatabaseSession;
					const installed = yield* installRevisionPackage(revisionPackage("notes"), owner);
					const destination = yield* repository.updateState({
						sortOrder: 0,
						isHidden: false,
						id: installed.installation.id,
						config: { token: "destination" },
					});
					assert(destination?.activeConfigRevisionId);
					const destinationConfigRevisionId = destination.activeConfigRevisionId;
					const input = {
						sortOrder: 4,
						userId: owner,
						isHidden: true,
						userSettings: {},
						isInitialized: true,
						createdAt: timestamp,
						updatedAt: timestamp,
						id: "archive-installation",
						pluginId: installed.pluginId,
						health: "installing" as const,
						config: { token: "archived" },
					};
					const persistence = yield* BackupRestorePersistence;
					yield* persistence.restoreInstallation({ ...input, preserveExistingConfig: true });
					const preserved = yield* repository.findByUserAndPlugin(owner, installed.pluginId);
					expect(preserved?.activeConfigRevisionId).toBe(destination.activeConfigRevisionId);
					expect(preserved?.config).toEqual({ token: "destination" });
					yield* repository.remove(installed.installation.id);
					yield* persistence.restoreInstallation({ ...input, preserveExistingConfig: false });
					const restored = yield* repository.findByUserAndPlugin(owner, installed.pluginId);
					assert(restored?.activeConfigRevisionId);
					expect(restored.id).toBe(installed.installation.id);
					expect(restored.uninstalledAt).toBeNull();
					expect(restored.isInitialized).toBe(true);
					expect(restored.config).toEqual({ token: "archived" });
					expect(restored.activeConfigRevisionId).not.toBe(destination.activeConfigRevisionId);
					const [retained] = yield* session.run((db) =>
						db
							.select()
							.from(tables.pluginConfigRevision)
							.where(eq(tables.pluginConfigRevision.id, destinationConfigRevisionId)),
					);
					assert(retained?.encryptedPayload);
					expect(retained.encryptedPayload.toString()).not.toContain("destination");
					expect(
						(yield* repository.findByUserAndPlugin(owner, installed.pluginId))?.config,
					).toEqual({ token: "archived" });
					expect(yield* clientProjection(installed.installation.id)).toEqual({
						clientConfig: {},
						configuredSecretPaths: ["token"],
					});
				}),
		);
	});

	layer(
		BackupRestorePersistence.layer.pipe(
			Layer.provide(SavedViewsRepository.layer),
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect(
			"keeps system environment configuration separate from restored installation preferences",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const repository = yield* PluginInstallationRepository;
					const persistence = yield* BackupRestorePersistence;
					const installed = yield* installRevisionPackage(revisionPackage());
					const environmentRevisions = () =>
						session.run((db) =>
							db
								.select()
								.from(tables.pluginConfigRevision)
								.where(isNull(tables.pluginConfigRevision.ownerUserId)),
						);
					const before = yield* environmentRevisions();
					yield* persistence.restoreInstallation({
						sortOrder: 3,
						userId: owner,
						isHidden: true,
						userSettings: {},
						isInitialized: true,
						health: "installing",
						createdAt: timestamp,
						updatedAt: timestamp,
						pluginId: installed.pluginId,
						preserveExistingConfig: true,
						config: { token: "archive-secret" },
					});
					const state = yield* repository.findByUserAndPlugin(owner, installed.pluginId);
					expect(state?.config).toEqual({});
					expect(state?.activeConfigRevisionId).toBeNull();
					expect(yield* environmentRevisions()).toEqual(before);
				}),
		);
	});

	layer(
		PluginIngestionLock.layer.pipe(
			Layer.provide(
				Layer.succeed(SystemPlugins, { sources: [], packageIds: new Set<PluginPackageId>() }),
			),
			Layer.provideMerge(recordedActivationsLayer),
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect(
			"projects client config without secrets and recomputes it when the private revision changes",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const repository = yield* PluginInstallationRepository;
					const installed = yield* installRevisionPackage(configuredPackage("v1", false), owner);
					yield* repository.updateState({
						sortOrder: 0,
						isHidden: false,
						id: installed.installation.id,
						config: { token: "private-token", endpoint: "https://notes.test" },
					});
					expect(yield* clientProjection(installed.installation.id)).toEqual({
						configuredSecretPaths: ["token"],
						clientConfig: { endpoint: "https://notes.test" },
					});
					const pluginId = yield* session.transaction(
						(yield* PluginIngestionLock).persistUserPlugin(configuredPackage("v2", true), {
							scope: "user",
							ownerId: owner,
						}),
					);
					expect(yield* (yield* RecordedActivations).activated).toEqual([pluginId]);
					expect(yield* clientProjection(installed.installation.id)).toEqual({
						clientConfig: {},
						configuredSecretPaths: ["endpoint", "token"],
					});
					yield* repository.remove(installed.installation.id);
					expect(yield* clientProjection(installed.installation.id)).toEqual({
						clientConfig: {},
						configuredSecretPaths: [],
					});
				}),
		);
	});
});

const settingsPackage = (version: string, field: string) => {
	const plugin = revisionPackage(
		"notes",
		version,
		"notes-entity",
		fixtureManifest().metadata.packageId,
	);
	return {
		...plugin,
		manifest: {
			...plugin.manifest,
			userSettingsSchema: {
				unknownKeys: "strict" as const,
				fields: { [field]: { label: field, description: field, type: "string" as const } },
			},
		},
	} satisfies typeof plugin;
};

describe("pinned user settings", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect("reads the settings schema of the pinned revision after a plugin update", () =>
			Effect.gen(function* () {
				const installations = yield* PluginInstallationRepository;
				const first = yield* installRevisionPackage(settingsPackage("v1", "timezone"), owner);
				const second = yield* installRevisionPackage(settingsPackage("v2", "locale"), owner);
				expect(second.revisionId).not.toBe(first.revisionId);
				const pinned = (pluginRevisionId: string) =>
					installations.findUserSettingsForRevision({
						userId: owner,
						pluginRevisionId,
						pluginId: first.pluginId,
						installationId: first.installation.id,
					});
				expect((yield* pinned(first.revisionId))?.userSettingsSchema?.fields).toHaveProperty(
					"timezone",
				);
				expect((yield* pinned(second.revisionId))?.userSettingsSchema?.fields).toHaveProperty(
					"locale",
				);
				expect(
					(yield* installations.findUserSettings(owner, first.installation.id))?.userSettingsSchema
						?.fields,
				).toHaveProperty("locale");
			}),
		);
	});
});
