import { assert, describe, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { PluginId, PluginRevisionId, UserId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/revision.test-support";

import * as tables from "./tables/combined";

describe("plugin namespaces in the generated migration baseline", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect("enforces plugin identity and saved-view namespace constraints", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const owner = UserId.make("owner");
				const packageValue = revisionPackage("whiskey", "v1", "bottle");
				const otherPackage = revisionPackage("other", "v1", "other-bottle");
				const system = yield* installRevisionPackage(packageValue);
				const privatePlugin = yield* installRevisionPackage(packageValue, owner);
				const otherSystem = yield* installRevisionPackage(otherPackage);

				const duplicateSystemPackage = yield* Effect.result(
					session.run((db) =>
						db.transaction((tx) =>
							tx
								.insert(tables.plugin)
								.values({
									slug: "whiskey-copy",
									status: "installing",
									packageId: packageValue.manifest.metadata.packageId,
								}),
						),
					),
				);
				assert(Result.isFailure(duplicateSystemPackage));
				assert(duplicateSystemPackage.failure instanceof DbError);
				expect(duplicateSystemPackage.failure.code).toBe("23505");

				const duplicatePrivatePackage = yield* Effect.result(
					session.run((db) =>
						db.transaction((tx) =>
							tx
								.insert(tables.plugin)
								.values({
									ownerId: owner,
									status: "installing",
									slug: "private-whiskey-copy",
									packageId: packageValue.manifest.metadata.packageId,
								}),
						),
					),
				);
				assert(Result.isFailure(duplicatePrivatePackage));
				assert(duplicatePrivatePackage.failure instanceof DbError);
				expect(duplicatePrivatePackage.failure.code).toBe("23505");

				const changedPackageId = yield* Effect.result(
					session.run((db) =>
						db.transaction((tx) =>
							tx
								.update(tables.plugin)
								.set({ packageId: otherPackage.manifest.metadata.packageId })
								.where(eq(tables.plugin.id, system.pluginId)),
						),
					),
				);
				assert(Result.isFailure(changedPackageId));
				assert(changedPackageId.failure instanceof DbError);
				expect(changedPackageId.failure.code).toBe("55000");

				const mismatchedRevisionIdentity = yield* Effect.result(
					session.run((db) =>
						db.transaction((tx) =>
							tx
								.insert(tables.pluginRevision)
								.values({
									pluginId: system.pluginId,
									manifest: otherPackage.manifest,
									clientConfigSchema: { fields: {} },
									sourceHash: otherPackage.sourceHash,
								}),
						),
					),
				);
				assert(Result.isFailure(mismatchedRevisionIdentity));
				assert(mismatchedRevisionIdentity.failure instanceof DbError);
				expect(mismatchedRevisionIdentity.failure.code).toBe("23514");

				const changedRevisionManifest = yield* Effect.result(
					session.run((db) =>
						db.transaction((tx) =>
							tx
								.update(tables.pluginRevision)
								.set({ manifest: otherPackage.manifest })
								.where(eq(tables.pluginRevision.id, system.revisionId)),
						),
					),
				);
				assert(Result.isFailure(changedRevisionManifest));
				assert(changedRevisionManifest.failure instanceof DbError);
				expect(changedRevisionManifest.failure.code).toBe("55000");

				const changedRevisionSourceHash = yield* Effect.result(
					session.run((db) =>
						db.transaction((tx) =>
							tx
								.update(tables.pluginRevision)
								.set({ sourceHash: `${packageValue.sourceHash}-changed` })
								.where(eq(tables.pluginRevision.id, system.revisionId)),
						),
					),
				);
				assert(Result.isFailure(changedRevisionSourceHash));
				assert(changedRevisionSourceHash.failure instanceof DbError);
				expect(changedRevisionSourceHash.failure.code).toBe("55000");

				const renamed = yield* session.run((db) =>
					db
						.update(tables.plugin)
						.set({ slug: "renamed-whiskey" })
						.where(eq(tables.plugin.id, system.pluginId))
						.returning({
							id: tables.plugin.id,
							slug: tables.plugin.slug,
							packageId: tables.plugin.packageId,
						}),
				);
				expect(renamed).toEqual([
					{
						id: system.pluginId,
						slug: "renamed-whiskey",
						packageId: packageValue.manifest.metadata.packageId,
					},
				]);

				const mismatchedActiveRevision = yield* Effect.result(
					session.run((db) =>
						db.transaction((tx) =>
							tx
								.update(tables.plugin)
								.set({ activeRevisionId: otherSystem.revisionId })
								.where(eq(tables.plugin.id, system.pluginId)),
						),
					),
				);
				assert(Result.isFailure(mismatchedActiveRevision));
				assert(mismatchedActiveRevision.failure instanceof DbError);
				expect(mismatchedActiveRevision.failure.code).toBe("23503");

				const override = { sortOrder: 0, userId: owner, slug: "bottle" };
				yield* session.run((db) =>
					db.insert(tables.savedViewOverride).values([
						{ ...override, pluginId: null },
						{ ...override, pluginId: system.pluginId },
						{ ...override, pluginId: privatePlugin.pluginId },
					]),
				);

				const duplicateKernelOverride = yield* Effect.result(
					session.run((db) =>
						db.transaction((tx) =>
							tx.insert(tables.savedViewOverride).values({ ...override, pluginId: null }),
						),
					),
				);
				assert(Result.isFailure(duplicateKernelOverride));
				assert(duplicateKernelOverride.failure instanceof DbError);
				expect(duplicateKernelOverride.failure.code).toBe("23505");

				const duplicateSystemOverride = yield* Effect.result(
					session.run((db) =>
						db.transaction((tx) =>
							tx
								.insert(tables.savedViewOverride)
								.values({ ...override, pluginId: system.pluginId }),
						),
					),
				);
				assert(Result.isFailure(duplicateSystemOverride));
				assert(duplicateSystemOverride.failure instanceof DbError);
				expect(duplicateSystemOverride.failure.code).toBe("23505");

				const duplicatePrivateOverride = yield* Effect.result(
					session.run((db) =>
						db.transaction((tx) =>
							tx
								.insert(tables.savedViewOverride)
								.values({ ...override, pluginId: privatePlugin.pluginId }),
						),
					),
				);
				assert(Result.isFailure(duplicatePrivateOverride));
				assert(duplicatePrivateOverride.failure instanceof DbError);
				expect(duplicatePrivateOverride.failure.code).toBe("23505");
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"stores equal local names without replacing another package or retained private authority",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const packages = yield* PluginRepository;
					const installations = yield* PluginInstallationRepository;
					const a = revisionPackage("whiskey", "v1", "bottle");
					const b = revisionPackage("whiskey", "v1", "bottle");
					const privateA = yield* installRevisionPackage(a, UserId.make("owner"));
					const systemA = yield* installRevisionPackage(a);
					const systemB = yield* installRevisionPackage(b);
					yield* session.transaction(
						Effect.gen(function* () {
							yield* packages.lockIngestion();
							yield* installations.quarantinePackageIdentityConflicts(
								a.manifest.metadata.packageId,
							);
						}),
					);
					expect(new Set([privateA.pluginId, systemA.pluginId, systemB.pluginId]).size).toBe(3);
					const definitions = yield* session.run((db) =>
						db
							.select({ pluginId: tables.userEntitySchema.pluginId })
							.from(tables.userEntitySchema)
							.where(
								and(
									eq(tables.userEntitySchema.userId, "owner"),
									eq(tables.userEntitySchema.slug, "bottle"),
									eq(tables.userEntitySchema.isEffective, true),
								),
							),
					);
					expect(
						definitions
							.map(({ pluginId }) => {
								assert(pluginId !== null);
								return pluginId;
							})
							.sort((left, right) => {
								if (left < right) {
									return -1;
								}
								return left > right ? 1 : 0;
							}),
					).toEqual(
						[systemA.pluginId, systemB.pluginId].sort((left, right) => {
							if (left < right) {
								return -1;
							}
							return left > right ? 1 : 0;
						}),
					);
					const retained = yield* installations.findById(privateA.installation.id);
					assert(retained);
					expect(retained.health).toBe("incompatible");
					expect(retained.incompatibilityReason).toBe("package-identity-conflict");
					expect(retained.activeConfigRevisionId).toBe(
						privateA.installation.activeConfigRevisionId,
					);
					const [authority] = yield* session.run((db) =>
						db
							.select()
							.from(tables.pluginRevisionSandboxAuthority)
							.where(eq(tables.pluginRevisionSandboxAuthority.id, privateA.revisionId)),
					);
					assert(authority);
					expect(authority.sandboxAuthority.packageId).toBe(a.manifest.metadata.packageId);
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"keeps private active definitions user-specific and retained revision metadata exact",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const definitions = yield* DefinitionRepository;
					const original = revisionPackage("whiskey", "v1", "bottle");
					const owner = UserId.make("owner");
					const recipient = UserId.make("recipient");
					const first = yield* installRevisionPackage(original, owner);
					const second = yield* installRevisionPackage(original, recipient);
					const next = revisionPackage(
						"whiskey",
						"v2",
						"bottle",
						original.manifest.metadata.packageId,
					);
					const upgraded = yield* installRevisionPackage(
						{
							...next,
							manifest: {
								...next.manifest,
								entitySchemas: next.manifest.entitySchemas.map((schema) =>
									Object.assign({}, schema, {
										propertiesSchema: {
											...schema.propertiesSchema,
											fields: {
												...schema.propertiesSchema.fields,
												label: { type: "string", label: "Label", description: "Optional label" },
											},
										},
									}),
								),
							},
						},
						owner,
					);
					expect(upgraded.pluginId).toBe(first.pluginId);
					expect(upgraded.revisionId).not.toBe(first.revisionId);
					expect(second.pluginId).not.toBe(first.pluginId);
					const ownerSnapshot = yield* definitions.getUserSnapshot(owner, { listed: false });
					const recipientSnapshot = yield* definitions.getUserSnapshot(recipient, {
						listed: false,
					});
					const ownerKey = definitionKey("entity", definitionOwner(first.pluginId), "bottle");
					const recipientKey = definitionKey("entity", definitionOwner(second.pluginId), "bottle");
					expect(ownerSnapshot.entitySchemas[ownerKey]?.propertiesSchema.fields).toHaveProperty(
						"label",
					);
					expect(
						recipientSnapshot.entitySchemas[recipientKey]?.propertiesSchema.fields,
					).not.toHaveProperty("label");
					const pinned = yield* definitions.getSnapshotForContext(
						{
							pluginId: PluginId.make(first.pluginId),
							pluginRevisionId: PluginRevisionId.make(first.revisionId),
						},
						owner,
					);
					expect(pinned.entitySchemas[ownerKey]?.propertiesSchema.fields).not.toHaveProperty(
						"label",
					);
					const activeRows = yield* session.run((db) =>
						db
							.select({ revision: tables.userEntitySchema.pluginRevisionId })
							.from(tables.userEntitySchema)
							.where(
								and(
									eq(tables.userEntitySchema.userId, owner),
									eq(tables.userEntitySchema.pluginId, first.pluginId),
									eq(tables.userEntitySchema.slug, "bottle"),
								),
							),
					);
					expect(activeRows).toEqual([{ revision: upgraded.revisionId }]);
				}),
		);
	});
});
