import { expect, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq, isNull } from "drizzle-orm";
import { Context, Effect, Layer, Ref } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { PluginIngestionLock } from "./ingestion-lock";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginRevisionActivation } from "./revision-activation";
import {
	installRevisionPackage,
	revisionPackage,
	revisionDatabaseLayer,
} from "./revision.test-support";

const owner = UserId.make("owner");
const timestamp = new Date("2026-08-23T12:00:00.000Z");

const configuredPackage = (version: string, endpointSecret: boolean) => {
	const plugin = revisionPackage("notes", version);
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
						expect(yield* repository.findHomeSavedView(owner, id)).toEqual({
							view: { renderer, isHidden: false },
						});
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
			Layer.provideMerge(recordedActivationsLayer),
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect(
			"projects client config without secrets and recomputes it when the private revision changes",
			() =>
				Effect.gen(function* () {
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
					const pluginId = yield* (yield* PluginIngestionLock).persistUserPlugin(
						configuredPackage("v2", true),
						{ slug: "notes", scope: "user", ownerId: owner },
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
