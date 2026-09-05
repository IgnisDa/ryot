import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import { DEFAULT_AUTOMATION_RETRY_POLICY } from "@ryot-app/contract/modules/automations/lifecycle";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";

import { PluginInstallationRepository } from "./installation-repository";
import { clientArtifactMatches, PluginRepository } from "./repository";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "./revision.test-support";
import { PluginRuntimeResolver } from "./runtime-resolver";

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
	it.effect(
		"selects the booted kernel artifact after downgrade and prunes only unpinned old code",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const repository = yield* PluginRepository;
					const runtime = yield* PluginRuntimeResolver;
					const first = revisionPackage().scripts[0];
					assert(first);
					const { entry: _entry, ...old } = first;
					const newer = { ...old, source: "new", compiledCode: "new", contentHash: "new-kernel" };
					expect(yield* runtime.findKernelScript(old.slug)).toBeNull();
					yield* repository.persistKernelScript(old);
					const retained = yield* runtime.findKernelScript(old.slug);
					assert(retained);
					yield* repository.persistKernelScript(newer);
					expect((yield* runtime.findKernelScript(old.slug))?.contentHash).toBe(newer.contentHash);
					const newerRow = yield* runtime.findKernelScript(old.slug);
					assert(newerRow);
					yield* db
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
						});
					yield* db
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
						});
					yield* repository.persistKernelScript(old);
					expect((yield* runtime.findKernelScript(old.slug))?.id).toBe(retained.id);
					expect(
						Result.isFailure(
							yield* Effect.result(
								db.transaction((tx) =>
									repository
										.persistKernelScript({ ...old, source: "conflicting-source" })
										.pipe(Effect.provideService(Database, tx)),
								),
							),
						),
					).toBe(true);
					expect((yield* runtime.findKernelScript(old.slug))?.id).toBe(retained.id);
					yield* repository.deleteUnreferencedScripts(
						new Set(yield* repository.listPersistedLivenessContentHashes(cleanupNow)),
						cleanupInput,
					);
					expect((yield* db.select().from(tables.sandboxScript)).length).toBe(2);
					yield* db
						.update(tables.automationRun)
						.set({ sandboxScriptId: null })
						.where(eq(tables.automationRun.id, "kernel-run"));
					yield* repository.deleteUnreferencedScripts(
						new Set(yield* repository.listPersistedLivenessContentHashes(cleanupNow)),
						cleanupInput,
					);
					expect((yield* db.select().from(tables.sandboxScript)).map(({ id }) => id)).toEqual([
						retained.id,
					]);
				}),
			),
	);
	it.effect("resolves portable provider identity and preserves it across package upgrades", () =>
		withRevisionDatabase(
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
		),
	);
	it.effect("returns current persisted test-support handles across private package updates", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const repository = yield* PluginRepository;
				const first = yield* installRevisionPackage(revisionPackage("handle-fixture", "v1"), owner);
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
		),
	);

	it.effect(
		"fences entity references by stable plugin ownership rather than a colliding schema slug",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const repository = yield* PluginRepository;
					const first = yield* installRevisionPackage(revisionPackage("notes"), owner);
					const other = yield* installRevisionPackage(
						revisionPackage("notes"),
						UserId.make("recipient"),
					);
					yield* db
						.insert(tables.entity)
						.values({
							userId: owner,
							name: "Owned notes",
							entitySchemaSlug: "notes-entity",
							entitySchemaPluginId: first.pluginId,
						});
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
			),
	);

	it.effect(
		"detects provider-backed references even when the entity has another definition owner",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const repository = yield* PluginRepository;
					const installed = yield* installRevisionPackage(revisionPackage());
					const provider = yield* repository.resolveProviderBySlugs({
						pluginId: installed.pluginId,
						providerSlug: "fixture-provider",
					});
					assert(provider);
					yield* db
						.insert(tables.entity)
						.values({
							userId: owner,
							name: "Provider entity",
							providerId: provider.id,
							entitySchemaSlug: "kernel-entity",
						});
					expect(
						yield* repository.hasEntityReferences({
							entitySchemaSlugs: [],
							pluginId: installed.pluginId,
						}),
					).toBe(true);
				}),
			),
	);

	it.effect("fences integrations on the exact plugin and optional installation", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const db = yield* Database;
				const repository = yield* PluginRepository;
				const first = yield* installRevisionPackage(revisionPackage("notes"), owner);
				const second = yield* installRevisionPackage(
					revisionPackage("notes"),
					UserId.make("recipient"),
				);
				yield* db
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
					});
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
		),
	);

	it.effect("loads manifests and source-hash entries through the active revision", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const repository = yield* PluginRepository;
				const first = revisionPackage();
				yield* installRevisionPackage(first);
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
		),
	);

	it.effect("updates provider operation pointers without changing retained script rows", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const db = yield* Database;
				const first = yield* installRevisionPackage(revisionPackage());
				const old = yield* db.select().from(tables.sandboxProviderOperation);
				yield* installRevisionPackage(revisionPackage("fixture", "v2"));
				const current = yield* db.select().from(tables.sandboxProviderOperation);
				expect(current.map(({ providerId }) => providerId)).toEqual(
					old.map(({ providerId }) => providerId),
				);
				expect(current.map(({ scriptId }) => scriptId)).not.toEqual(
					old.map(({ scriptId }) => scriptId),
				);
				expect(current.find(({ operation }) => operation === "search")?.optionsSchema).toEqual({
					fields: {},
				});
				expect(
					(yield* db
						.select()
						.from(tables.sandboxScript)
						.where(eq(tables.sandboxScript.pluginRevisionId, first.revisionId))).length,
				).toBe(5);
			}),
		),
	);

	it.effect("deactivates package identity without immediately deleting scripts", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const db = yield* Database;
				const repository = yield* PluginRepository;
				const installed = yield* installRevisionPackage(revisionPackage());
				yield* repository.deactivate(installed.pluginId);
				expect(yield* repository.listActiveSystemPlugins()).toEqual([]);
				expect((yield* db.select().from(tables.sandboxScript)).length).toBe(5);
			}),
		),
	);

	it.effect(
		"retains a complete old executable revision while a workflow can still call its siblings",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const repository = yield* PluginRepository;
					const first = yield* installRevisionPackage(revisionPackage());
					const [root] = yield* db
						.select()
						.from(tables.sandboxScript)
						.where(
							and(
								eq(tables.sandboxScript.pluginRevisionId, first.revisionId),
								eq(tables.sandboxScript.slug, "fixture.workflow"),
							),
						);
					assert(root);
					yield* db
						.insert(tables.sandboxWorkflowReference)
						.values({
							scriptId: root.id,
							pluginId: first.pluginId,
							executionId: "suspended",
							contentHash: root.contentHash,
							pluginInstallationId: first.installation.id,
						});
					yield* installRevisionPackage(revisionPackage("fixture", "v2"));
					yield* repository.deleteUnreferencedScripts(new Set(), cleanupInput);
					expect(
						(yield* db
							.select()
							.from(tables.sandboxScript)
							.where(eq(tables.sandboxScript.pluginRevisionId, first.revisionId))).length,
					).toBe(5);
					expect(yield* repository.listPersistedLivenessContentHashes(cleanupNow)).toContain(
						"fixture.task-v1",
					);
					yield* db.delete(tables.sandboxWorkflowReference);
					yield* repository.deleteUnreferencedScripts(new Set(), cleanupInput);
					expect(
						yield* db
							.select()
							.from(tables.sandboxScript)
							.where(eq(tables.sandboxScript.pluginRevisionId, first.revisionId)),
					).toEqual([]);
				}),
			),
	);
	it.effect("deletes only unreferenced inactive private tombstones", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const db = yield* Database;
				const repository = yield* PluginRepository;
				const installations = yield* PluginInstallationRepository;
				const installed = yield* installRevisionPackage(revisionPackage("notes"), owner);
				yield* installations.remove(installed.installation.id);
				yield* repository.deactivate(installed.pluginId);
				expect(yield* repository.deleteInactiveUnreferencedPlugins(500)).toEqual([]);
				yield* db
					.update(tables.pluginInstallation)
					.set({ uninstalledAt: expired })
					.where(eq(tables.pluginInstallation.id, installed.installation.id));
				yield* repository.pruneRevisionArtifacts({ ...cleanupInput, retryWindowDays: 7 });
				expect(yield* repository.deleteInactiveUnreferencedPlugins(500)).toEqual([
					{ id: installed.pluginId },
				]);
				expect(yield* db.select().from(tables.pluginRevision)).toEqual([]);
			}),
		),
	);

	it.effect("reloads exact source bytes and denies another user's installation", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const repository = yield* PluginRepository;
				const packageValue = {
					...revisionPackage("notes"),
					files: { "backend/main.ts": new Uint8Array([0, 255, 1]) },
				};
				const installed = yield* installRevisionPackage(packageValue, owner);
				expect(yield* repository.listSourceFiles(installed.pluginId)).toEqual(packageValue.files);
				expect(
					yield* repository.listAuthorizedSourceFiles({
						userId: "owner",
						pluginId: installed.pluginId,
						sourceHash: packageValue.sourceHash,
						installationId: installed.installation.id,
					}),
				).toEqual(packageValue.files);
				expect(
					yield* repository.listAuthorizedSourceFiles({
						userId: "recipient",
						pluginId: installed.pluginId,
						sourceHash: packageValue.sourceHash,
						installationId: installed.installation.id,
					}),
				).toBeNull();
			}),
		),
	);
});
