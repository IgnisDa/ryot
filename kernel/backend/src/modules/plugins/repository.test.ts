import { expect, it, layer } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import { DEFAULT_AUTOMATION_RETRY_POLICY } from "@ryot-app/contract/modules/automations/lifecycle";
import { UserId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	clientArtifactMatches,
	ClientArtifactsRepository,
} from "#modules/client-artifacts/repository";

import { PluginInstallationRepository } from "./installation-repository";
import { pluginSourceHash } from "./pipeline";
import { PluginRepository } from "./repository";
import {
	installRevisionPackage,
	revisionPackage,
	revisionDatabaseLayer,
} from "./revision.test-support";
import { PluginRuntimeResolver } from "./runtime-resolver";
import { fixtureClientArtifact } from "./source.test-support";
import { fixtureManifest } from "./test-support";

const owner = UserId.make("owner");
const expired = new Date(0);
const cleanupNow = new Date("2026-09-16T00:00:00Z");
const cleanupInput = { limit: 500, now: cleanupNow };

it("matches immutable client artifacts by exact bytes", () => {
	const metadata = {
		hash: "artifact",
		format: CLIENT_ARTIFACT_FORMAT,
		apiVersion: CLIENT_API_VERSION,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	};
	const artifact = {
		...metadata,
		files: [
			{
				name: "asset.bin",
				contents: new Uint8Array([0, 255, 1]),
				contentType: "application/octet-stream",
			},
		],
	};
	const files = [
		{
			name: "asset.bin",
			artifactHash: metadata.hash,
			contents: Buffer.from([0, 255, 1]),
			contentType: "application/octet-stream",
		},
	];
	const file = artifact.files[0];
	assert(file);
	expect(clientArtifactMatches(artifact, metadata, files)).toBe(true);
	expect(
		clientArtifactMatches(
			{ ...artifact, files: [{ ...file, contents: new Uint8Array([0, 254, 1]) }] },
			metadata,
			files,
		),
	).toBe(false);
});

describe("plugin repository revisions", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect("rotates activation on reinstall and retains the committed uninstall receipt", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* PluginRepository;
				const installations = yield* PluginInstallationRepository;
				const pluginPackage = revisionPackage("retry-identity", "v1");
				const identity = {
					ownerId: null,
					scope: "system",
					slug: pluginPackage.manifest.metadata.slug,
				} satisfies Parameters<PluginRepository["Service"]["persist"]>[1];
				const id = yield* repository.persist(pluginPackage, identity);
				const first = yield* repository.findActiveSystemPlugin(identity.slug);
				assert(first);
				yield* session.transaction(
					Effect.gen(function* () {
						yield* repository.deactivate(id);
						yield* repository.recordUninstallReceipt({
							pluginId: id,
							ownerId: null,
							slug: identity.slug,
							installationId: null,
							activationId: first.activationId,
						});
					}),
				);
				expect(yield* repository.findUninstallReceipt(first.activationId)).toMatchObject({
					pluginId: id,
				});
				expect(yield* repository.persist(pluginPackage, identity)).toBe(id);
				const replacement = yield* repository.findActiveSystemPlugin(identity.slug);
				assert(replacement);
				expect(replacement.activationId).not.toBe(first.activationId);
				expect(yield* repository.findUninstallReceipt(first.activationId)).toMatchObject({
					pluginId: id,
				});
				const installation = yield* installations.upsertState({
					config: {},
					pluginId: id,
					sortOrder: 0,
					userId: owner,
					isHidden: false,
					health: "installing",
				});
				assert(installation);
				expect(
					yield* installations.updateHealthForActivation({
						health: "failed",
						id: installation.id,
						healthReason: "stale",
						activationId: first.activationId,
					}),
				).toBe(false);
				expect((yield* installations.findById(installation.id))?.health).toBe("installing");
				expect(
					yield* installations.updateHealthForActivation({
						health: "ready",
						healthReason: null,
						id: installation.id,
						activationId: replacement.activationId,
					}),
				).toBe(true);
			}),
		);
		test.effect("retains and exports a precompiled client artifact for the active package", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* PluginRepository;
				const artifacts = yield* ClientArtifactsRepository;
				const base = fixtureManifest();
				const manifest = {
					...base,
					client: {
						homeView: null,
						apiVersion: CLIENT_API_VERSION,
						exports: {
							card: {
								entry: "client/index.ts",
								kind: "component" as const,
								automaticEntityPresentations: false,
							},
						},
					},
				};
				const compiledClient = fixtureClientArtifact(manifest.metadata.name);
				const entry = manifest.scripts[0]?.entry;
				assert(entry);
				const javascript = "export {};";
				const compiledScripts = [{ entry, format: 1, javascript }];
				const plugin = {
					manifest,
					compiledClient,
					sourceHash: pluginSourceHash(manifest, compiledScripts, compiledClient),
					scripts: manifest.scripts.map((script) => {
						const { entry: scriptEntry, ...metadata } = script;
						return {
							metadata,
							slug: script.slug,
							name: script.name,
							compiledFormat: 1,
							entry: scriptEntry,
							compiledCode: javascript,
							contentHash: sha256Hex(javascript),
						};
					}),
				};
				const pluginId = yield* repository.persist(plugin, {
					scope: "user",
					ownerId: owner,
					slug: manifest.metadata.slug,
				});
				yield* session.run((db) =>
					db
						.insert(tables.clientArtifact)
						.values({
							format: 0,
							hash: "unrelated-artifact",
							apiVersion: CLIENT_API_VERSION,
							compilerVersion: CLIENT_COMPILER_VERSION,
							bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
						}),
				);
				yield* session.run((db) =>
					db
						.insert(tables.clientArtifactFile)
						.values({
							name: "ignored.bin",
							contents: Buffer.from([0]),
							artifactHash: "unrelated-artifact",
							contentType: "application/octet-stream",
						}),
				);

				expect(yield* repository.listCompiledPackageArtifacts(pluginId)).toEqual({
					compiledClient,
					compiledScripts,
				});
				const [revision] = yield* session.run((db) =>
					db
						.select({
							id: tables.pluginRevision.id,
							clientArtifactHash: tables.pluginRevision.clientArtifactHash,
						})
						.from(tables.pluginRevision)
						.where(eq(tables.pluginRevision.pluginId, pluginId)),
				);
				assert(revision);
				expect(revision.clientArtifactHash).toBe(compiledClient.hash);
				expect(yield* repository.findRevisionClientArtifact(revision.id)).toEqual(compiledClient);
				expect(
					yield* repository.findClientArtifactForSource({
						pluginId,
						sourceHash: plugin.sourceHash,
					}),
				).toEqual(compiledClient);
				expect(
					yield* repository.findClientArtifactForSource({ pluginId, sourceHash: "missing-source" }),
				).toBeNull();
				yield* session.run((db) =>
					db
						.update(tables.pluginRevision)
						.set({ sourceHash: "changed-package-hash" })
						.where(eq(tables.pluginRevision.id, revision.id)),
				);
				expect(
					Result.isFailure(yield* Effect.result(repository.listCompiledPackageArtifacts(pluginId))),
				).toBe(true);
				yield* session.run((db) =>
					db
						.update(tables.pluginRevision)
						.set({ sourceHash: plugin.sourceHash })
						.where(eq(tables.pluginRevision.id, revision.id)),
				);

				yield* session.run((db) =>
					db
						.update(tables.pluginRevision)
						.set({ clientArtifactHash: null })
						.where(eq(tables.pluginRevision.id, revision.id)),
				);
				expect(
					yield* repository.findClientArtifactForSource({
						pluginId,
						sourceHash: plugin.sourceHash,
					}),
				).toBeNull();
				expect(
					Result.isFailure(
						yield* Effect.result(
							repository.persist(plugin, {
								scope: "user",
								ownerId: owner,
								slug: manifest.metadata.slug,
							}),
						),
					),
				).toBe(true);

				yield* session.run((db) =>
					db
						.update(tables.pluginRevision)
						.set({ clientArtifactHash: compiledClient.hash })
						.where(eq(tables.pluginRevision.id, revision.id)),
				);
				const artifactFile = compiledClient.files[0];
				assert(artifactFile);
				yield* session.run((db) =>
					db
						.update(tables.clientArtifactFile)
						.set({ contents: Buffer.from([...artifactFile.contents, 0]) })
						.where(
							and(
								eq(tables.clientArtifactFile.artifactHash, compiledClient.hash),
								eq(tables.clientArtifactFile.name, artifactFile.name),
							),
						),
				);
				expect(
					Result.isFailure(
						yield* Effect.result(repository.findRevisionClientArtifact(revision.id)),
					),
				).toBe(true);
				expect(
					Result.isFailure(yield* Effect.result(artifacts.persistClientArtifact(compiledClient))),
				).toBe(true);
				expect(
					Result.isFailure(yield* Effect.result(repository.listCompiledPackageArtifacts(pluginId))),
				).toBe(true);
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"selects the booted kernel artifact after downgrade and prunes only unpinned old code",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const repository = yield* PluginRepository;
					const runtime = yield* PluginRuntimeResolver;
					const first = revisionPackage().scripts[0];
					assert(first);
					const { entry: _entry, ...script } = first;
					const old = { ...script, source: "old" };
					const newer = { ...old, source: "new", compiledCode: "new", contentHash: "new-kernel" };
					expect(yield* runtime.findKernelScript(old.slug)).toBeNull();
					yield* repository.persistKernelScript(old);
					const retained = yield* runtime.findKernelScript(old.slug);
					assert(retained);
					yield* repository.persistKernelScript(newer);
					expect((yield* runtime.findKernelScript(old.slug))?.contentHash).toBe(newer.contentHash);
					const newerRow = yield* runtime.findKernelScript(old.slug);
					assert(newerRow);
					yield* session.run((db) =>
						db
							.insert(tables.automationTrigger)
							.values({
								depth: 0,
								source: "api",
								operation: "emit",
								category: "signal",
								occurredAt: expired,
								id: "kernel-trigger",
								resourceKind: "signal",
								initiatorKind: "system",
								payloadPrunedAt: expired,
								executionId: "kernel-command",
								rootExecutionId: "kernel-command",
							}),
					);
					yield* session.run((db) =>
						db
							.insert(tables.automationRun)
							.values({
								stage: "after",
								id: "kernel-run",
								status: "failed",
								delivery: "async",
								scriptSlug: newer.slug,
								artifactsExpireAt: expired,
								triggerId: "kernel-trigger",
								sandboxScriptId: newerRow.id,
								hookSlug: "kernel.notification",
								hookName: "Kernel notification",
								scriptContentHash: newer.contentHash,
								retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
							}),
					);
					yield* repository.persistKernelScript(old);
					expect((yield* runtime.findKernelScript(old.slug))?.id).toBe(retained.id);
					expect(
						Result.isFailure(
							yield* Effect.result(
								repository.persistKernelScript({ ...old, compiledCode: "conflicting-code" }),
							),
						),
					).toBe(true);
					expect((yield* runtime.findKernelScript(old.slug))?.id).toBe(retained.id);
					yield* repository.deleteUnreferencedScripts(
						new Set(yield* repository.listPersistedLivenessContentHashes(cleanupNow)),
						cleanupInput,
					);
					expect(yield* session.run((db) => db.select().from(tables.sandboxScript))).toHaveLength(
						2,
					);
					yield* session.run((db) =>
						db
							.update(tables.automationRun)
							.set({ sandboxScriptId: null })
							.where(eq(tables.automationRun.id, "kernel-run")),
					);
					yield* repository.deleteUnreferencedScripts(
						new Set(yield* repository.listPersistedLivenessContentHashes(cleanupNow)),
						cleanupInput,
					);
					expect(
						(yield* session.run((db) => db.select().from(tables.sandboxScript))).map(
							({ id }) => id,
						),
					).toEqual([retained.id]);
				}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"resolves portable provider identity and preserves it across package upgrades",
			() =>
				Effect.gen(function* () {
					const repository = yield* PluginRepository;
					const installed = yield* installRevisionPackage(revisionPackage());
					const before = yield* repository.resolveProviderBySlugs({
						pluginId: installed.pluginId,
						providerSlug: "fixture-provider",
					});
					assert(before);
					yield* installRevisionPackage(revisionPackage("fixture", "v2"));
					expect(
						yield* repository.resolveProviderBySlugs({
							pluginId: installed.pluginId,
							providerSlug: "fixture-provider",
						}),
					).toEqual(before);
					expect(
						yield* repository.resolveProviderBySlugs({
							pluginId: "other-plugin",
							providerSlug: "fixture-provider",
						}),
					).toBeNull();
				}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"returns current persisted test-support handles across private package updates",
			() =>
				Effect.gen(function* () {
					const repository = yield* PluginRepository;
					const first = yield* installRevisionPackage(
						revisionPackage("handle-fixture", "v1"),
						owner,
					);
					const before = yield* repository.findTestSupportOperationResult({
						scope: "user",
						ownerId: owner,
						slug: "handle-fixture",
					});
					assert(before);
					expect(before).toMatchObject({
						id: first.pluginId,
						activeRevisionId: first.revisionId,
						installationId: first.installation.id,
						configRevisionId: first.installation.activeConfigRevisionId,
					});
					expect(before.scripts).toHaveLength(5);

					const second = yield* installRevisionPackage(
						revisionPackage("handle-fixture", "v2"),
						owner,
					);
					const after = yield* repository.findTestSupportOperationResult({
						scope: "user",
						ownerId: owner,
						slug: "handle-fixture",
					});
					assert(after);
					expect(after.id).toBe(before.id);
					expect(after.installationId).toBe(before.installationId);
					expect(after.activeRevisionId).toBe(second.revisionId);
					expect(after.activeRevisionId).not.toBe(before.activeRevisionId);
					expect(after.scripts.map(({ id }) => id)).not.toEqual(before.scripts.map(({ id }) => id));
					expect(after.scripts.map(({ slug }) => slug)).toEqual(
						before.scripts.map(({ slug }) => slug),
					);
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"fences entity references by stable plugin ownership rather than a colliding schema slug",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const repository = yield* PluginRepository;
					const first = yield* installRevisionPackage(revisionPackage("notes"), owner);
					const other = yield* installRevisionPackage(
						revisionPackage("notes"),
						UserId.make("recipient"),
					);
					yield* session.run((db) =>
						db
							.insert(tables.entity)
							.values({
								userId: owner,
								name: "Owned notes",
								entitySchemaSlug: "notes-entity",
								entitySchemaPluginId: first.pluginId,
							}),
					);
					expect(
						yield* repository.hasEntityReferences({
							pluginId: first.pluginId,
							entitySchemaSlugs: ["notes-entity"],
						}),
					).toBe(true);
					expect(
						yield* repository.hasEntityReferences({
							pluginId: other.pluginId,
							entitySchemaSlugs: ["notes-entity"],
						}),
					).toBe(false);
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"detects provider-backed references even when the entity has another definition owner",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const repository = yield* PluginRepository;
					const installed = yield* installRevisionPackage(revisionPackage());
					const provider = yield* repository.resolveProviderBySlugs({
						pluginId: installed.pluginId,
						providerSlug: "fixture-provider",
					});
					assert(provider);
					yield* session.run((db) =>
						db
							.insert(tables.entity)
							.values({
								userId: owner,
								name: "Provider entity",
								providerId: provider.id,
								entitySchemaSlug: "kernel-entity",
							}),
					);
					expect(
						yield* repository.hasEntityReferences({
							entitySchemaSlugs: [],
							pluginId: installed.pluginId,
						}),
					).toBe(true);
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("fences integrations on the exact plugin and optional installation", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* PluginRepository;
				const first = yield* installRevisionPackage(revisionPackage("notes"), owner);
				const second = yield* installRevisionPackage(
					revisionPackage("notes"),
					UserId.make("recipient"),
				);
				yield* session.run((db) =>
					db
						.insert(tables.integration)
						.values({
							lot: "sink",
							userId: owner,
							providerSpecifics: {},
							provider: "notes-sink",
							clientProviderSpecifics: {},
							webhookToken: crypto.randomUUID(),
							pluginInstallationId: first.installation.id,
							extraSettings: { disableOnContinuousErrors: false },
						}),
				);
				expect(yield* repository.hasIntegrationReferences({ pluginId: first.pluginId })).toBe(true);
				expect(yield* repository.hasIntegrationReferences({ pluginId: second.pluginId })).toBe(
					false,
				);
				expect(
					yield* repository.hasIntegrationReferences({
						pluginId: first.pluginId,
						pluginInstallationId: second.installation.id,
					}),
				).toBe(false);
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("loads manifests and source-hash entries through the active revision", () =>
			Effect.gen(function* () {
				const repository = yield* PluginRepository;
				const first = revisionPackage();
				const installed = yield* installRevisionPackage(first);
				expect(yield* repository.findRevisionClientArtifact(installed.revisionId)).toBeNull();
				expect(
					(yield* repository.findActiveSystemPlugin("fixture"))?.manifest.metadata.version,
				).toBe("v1");
				expect(
					(yield* repository.findBySourceHash({
						ownerId: null,
						slug: "fixture",
						scope: "system",
						sourceHash: first.sourceHash,
					}))?.scripts.map(({ contentHash }) => contentHash),
				).toContain("fixture.details-v1");
				yield* installRevisionPackage(revisionPackage("fixture", "v2"));
				expect(
					yield* repository.findBySourceHash({
						ownerId: null,
						slug: "fixture",
						scope: "system",
						sourceHash: first.sourceHash,
					}),
				).toBeNull();
				expect((yield* repository.listPortablePluginMetadata())[0]?.version).toBe("v2");
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("projects active provider operations without changing retained script rows", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const first = yield* installRevisionPackage(revisionPackage());
				const old = yield* session.run((db) =>
					db.select().from(tables.userSandboxProviderOperation),
				);
				yield* installRevisionPackage(revisionPackage("fixture", "v2"));
				const current = yield* session.run((db) =>
					db.select().from(tables.userSandboxProviderOperation),
				);
				expect(current.map(({ providerId }) => providerId)).toEqual(
					old.map(({ providerId }) => providerId),
				);
				expect(current.map(({ operation }) => operation)).toEqual(
					old.map(({ operation }) => operation),
				);
				expect(current.find(({ operation }) => operation === "search")?.optionsSchema).toEqual({
					fields: {},
				});
				expect(
					(yield* session.run((db) =>
						db
							.select()
							.from(tables.sandboxScript)
							.where(eq(tables.sandboxScript.pluginRevisionId, first.revisionId)),
					)).length,
				).toBe(5);
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("enforces one immutable script per revision and slug", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const installed = yield* installRevisionPackage(revisionPackage());
				const [script] = yield* session.run((db) =>
					db
						.select()
						.from(tables.sandboxScript)
						.where(eq(tables.sandboxScript.pluginRevisionId, installed.revisionId))
						.limit(1),
				);
				assert(script);
				const duplicate = yield* Effect.result(
					session.transaction(
						session.run((db) =>
							db
								.insert(tables.sandboxScript)
								.values({ ...script, id: "conflicting-script", contentHash: "different-hash" }),
						),
					),
				);
				expect(Result.isFailure(duplicate)).toBe(true);
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("keeps system and user plugin slugs separate without a stored scope", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					db.insert(tables.plugin).values([
						{ id: "system", slug: "shared", status: "inactive" },
						{ id: "owner", slug: "shared", ownerId: "owner", status: "inactive" },
						{ slug: "shared", id: "recipient", status: "inactive", ownerId: "recipient" },
					]),
				);
				for (const duplicate of [
					{ slug: "shared", status: "inactive", id: "second-system" },
					{ slug: "shared", ownerId: "owner", id: "second-owner", status: "inactive" },
				]) {
					const result = yield* Effect.result(
						session.transaction(session.run((db) => db.insert(tables.plugin).values(duplicate))),
					);
					expect(Result.isFailure(result)).toBe(true);
				}
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("deactivates package identity without immediately deleting scripts", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* PluginRepository;
				const installed = yield* installRevisionPackage(revisionPackage());
				yield* repository.deactivate(installed.pluginId);
				expect(yield* repository.listActiveSystemPlugins()).toEqual([]);
				expect(yield* session.run((db) => db.select().from(tables.sandboxScript))).toHaveLength(5);
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"retains a complete old executable revision while a workflow can still call its siblings",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const repository = yield* PluginRepository;
					const first = yield* installRevisionPackage(revisionPackage());
					const [root] = yield* session.run((db) =>
						db
							.select()
							.from(tables.sandboxScript)
							.where(
								and(
									eq(tables.sandboxScript.pluginRevisionId, first.revisionId),
									eq(tables.sandboxScript.slug, "fixture.workflow"),
								),
							),
					);
					assert(root);
					yield* session.run((db) =>
						db
							.insert(tables.sandboxWorkflowReference)
							.values({
								scriptId: root.id,
								executionId: "suspended",
								pluginInstallationId: first.installation.id,
							}),
					);
					yield* installRevisionPackage(revisionPackage("fixture", "v2"));
					yield* repository.deleteUnreferencedScripts(new Set(), cleanupInput);
					expect(
						(yield* session.run((db) =>
							db
								.select()
								.from(tables.sandboxScript)
								.where(eq(tables.sandboxScript.pluginRevisionId, first.revisionId)),
						)).length,
					).toBe(5);
					expect(yield* repository.listPersistedLivenessContentHashes(cleanupNow)).toContain(
						"fixture.task-v1",
					);
					yield* session.run((db) => db.delete(tables.sandboxWorkflowReference));
					yield* repository.deleteUnreferencedScripts(new Set(), cleanupInput);
					expect(
						yield* session.run((db) =>
							db
								.select()
								.from(tables.sandboxScript)
								.where(eq(tables.sandboxScript.pluginRevisionId, first.revisionId)),
						),
					).toEqual([]);
				}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect("deletes only unreferenced inactive private tombstones", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* PluginRepository;
				const installations = yield* PluginInstallationRepository;
				const installed = yield* installRevisionPackage(revisionPackage("notes"), owner);
				yield* installations.remove(installed.installation.id);
				yield* repository.deactivate(installed.pluginId);
				expect(yield* repository.deleteInactiveUnreferencedPlugins(500)).toEqual([]);
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ uninstalledAt: expired })
						.where(eq(tables.pluginInstallation.id, installed.installation.id)),
				);
				yield* repository.pruneRevisionArtifacts({ ...cleanupInput, retryWindowDays: 7 });
				expect(yield* repository.deleteInactiveUnreferencedPlugins(500)).toEqual([
					{ id: installed.pluginId },
				]);
				expect(yield* session.run((db) => db.select().from(tables.pluginRevision))).toEqual([]);
			}),
		);
	});
});
