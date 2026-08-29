import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { and, eq, sql } from "drizzle-orm";
import { Data, Effect, Layer, Redacted, Result } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database, DatabaseLive } from "#lib/infrastructure/db/service";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { SandboxRepository } from "#modules/sandbox/repository";

import { PluginConfigRevisions } from "./config-revisions";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginRepository } from "./repository";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

class RollbackValidation extends Data.TaggedError("RollbackValidation") {}
const url = testDatabaseUrl();
const timestamp = new Date("2026-09-15T00:00:00Z");
const expiresAt = new Date("2100-01-01T00:00:00Z");
const expiredAt = new Date(0);
const environment = (token: string) =>
	makeConfigProviderLayer({ RYOT_PLUGIN_FIXTURE_TOKEN: token });
const config = makeAppConfigLayer({ database: { url: Redacted.make(url) } });
const services = Layer.mergeAll(
	PluginRepository.layer,
	PluginInstallationRepository.layer,
	PluginConfigRevisions.layer,
	SandboxRepository.layer,
);

describe("immutable revisions in PostgreSQL (isolated, rolled back schema)", () => {
	it.effect(
		"retains old pins through upgrade and uninstall, rejects mutations, and preserves shared history on user deletion",
		() =>
			Effect.gen(function* () {
				const db = yield* Database;
				const plugins = yield* PluginRepository;
				const installations = yield* PluginInstallationRepository;
				const configs = yield* PluginConfigRevisions;
				const sandbox = yield* SandboxRepository;
				const directory = new URL("../../drizzle/", import.meta.url).pathname;
				const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
				assert(paths.length === 1);
				const ddl = yield* Effect.tryPromise({
					try: () => Bun.file(directory + paths[0]).text(),
					catch: () => new DbError({ message: "Cannot read generated baseline" }),
				});
				yield* db
					.transaction((transaction) =>
						Effect.gen(function* () {
							yield* transaction.execute(sql`create schema phase2_revision_validation`);
							yield* transaction.execute(
								sql`set local search_path to phase2_revision_validation, public`,
							);
							for (const statement of ddl.split("--> statement-breakpoint")) {
								yield* transaction.execute(sql.raw(statement));
							}
							yield* transaction.insert(tables.user).values([
								{ id: "owner", name: "Owner", preferences: {}, email: "owner@example.test" },
								{
									id: "recipient",
									preferences: {},
									name: "Recipient",
									email: "recipient@example.test",
								},
							]);
							const baseManifest = fixtureManifest();
							const manifest: PluginManifest = {
								...baseManifest,
								workflows: [{ slug: "fixture-flow", scriptSlug: "fixture.workflow" }],
								configSchema: {
									unknownKeys: "strict" as const,
									fields: {
										token: {
											secret: true,
											label: "Token",
											type: "string" as const,
											description: "Private token",
										},
									},
								},
								scripts: [
									...baseManifest.scripts,
									{
										kind: "workflow",
										capabilities: [],
										slug: "fixture.workflow",
										name: "Fixture workflow",
										requiredPluginConfigKeys: [],
										requiredSystemConfigKeys: [],
										entry: "backend/workflow.sandbox.ts",
									},
								],
							};
							const packageAt = (version: string): NormalizedPlugin => ({
								sourceHash: version,
								files: { "backend/main.ts": new TextEncoder().encode(version) },
								manifest: { ...manifest, metadata: { ...manifest.metadata, version } },
								scripts: manifest.scripts.map(({ entry, ...metadata }) => ({
									entry,
									metadata,
									source: version,
									compiledFormat: 1,
									slug: metadata.slug,
									name: metadata.name,
									contentHash: version,
									compiledCode: version,
								})),
							});
							const pluginId = yield* plugins.persist(packageAt("v1"), {
								scope: "user",
								slug: "fixture",
								ownerId: "owner",
							});
							const installation = yield* installations.create({
								pluginId,
								config: {},
								sortOrder: 0,
								health: "ready",
								isDisabled: false,
								userId: UserId.make("owner"),
							});
							assert(installation?.activeConfigRevisionId);
							expect(yield* plugins.listSourceFiles(pluginId)).toEqual({
								"backend/main.ts": new TextEncoder().encode("v1"),
							});
							expect(
								yield* plugins.listAuthorizedSourceFiles({
									pluginId,
									sourceHash: "v1",
									userId: "recipient",
									installationId: installation.id,
								}),
							).toBeNull();
							const [script] = yield* transaction
								.select()
								.from(tables.sandboxScript)
								.where(
									and(
										eq(tables.sandboxScript.contentHash, "v1"),
										eq(tables.sandboxScript.slug, "fixture.automation"),
									),
								);
							assert(script?.pluginRevisionId);
							const retainedPin = {
								id: PluginId.make(pluginId),
								revisionId: PluginRevisionId.make(script.pluginRevisionId),
								configRevisionId: PluginConfigRevisionId.make(installation.activeConfigRevisionId),
							};
							expect(
								yield* configs.create({
									properties: {},
									ownerUserId: "owner",
									scope: "installation",
									pluginInstallationId: installation.id,
									pluginRevisionId: script.pluginRevisionId,
								}),
							).toBe(installation.activeConfigRevisionId);
							const conflict = yield* Effect.result(
								transaction.transaction((savepoint) =>
									plugins
										.persist(
											{
												...packageAt("v1"),
												manifest: {
													...manifest,
													metadata: { ...manifest.metadata, version: "mutated" },
												},
											},
											{ scope: "user", slug: "fixture", ownerId: "owner" },
										)
										.pipe(Effect.provideService(Database, savepoint)),
								),
							);
							expect(Result.isFailure(conflict)).toBe(true);
							const configUpdate = yield* installations.updateState({
								sortOrder: 0,
								isDisabled: false,
								id: installation.id,
								config: { token: "private-config-token" },
							});
							assert(configUpdate?.activeConfigRevisionId);
							expect(configUpdate.activeConfigRevisionId).not.toBe(retainedPin.configRevisionId);
							expect(
								yield* configs.read({
									ownerUserId: "owner",
									id: configUpdate.activeConfigRevisionId,
									pluginRevisionId: retainedPin.revisionId,
								}),
							).toEqual({ token: "private-config-token" });
							const sourceConflict = yield* Effect.result(
								transaction.transaction((savepoint) =>
									plugins
										.persist(
											{
												...packageAt("v1"),
												files: { "backend/main.ts": new TextEncoder().encode("changed") },
											},
											{ scope: "user", slug: "fixture", ownerId: "owner" },
										)
										.pipe(Effect.provideService(Database, savepoint)),
								),
							);
							expect(Result.isFailure(sourceConflict)).toBe(true);
							const scriptConflict = yield* Effect.result(
								transaction.transaction((savepoint) =>
									plugins
										.persist(
											{
												...packageAt("v1"),
												scripts: packageAt("v1").scripts.map((candidate) =>
													Object.assign(candidate, { compiledCode: "changed" }),
												),
											},
											{ scope: "user", slug: "fixture", ownerId: "owner" },
										)
										.pipe(Effect.provideService(Database, savepoint)),
								),
							);
							expect(Result.isFailure(scriptConflict)).toBe(true);
							expect(
								yield* plugins.persist(packageAt("v2"), {
									scope: "user",
									slug: "fixture",
									ownerId: "owner",
								}),
							).toBe(pluginId);
							yield* installations.updateState({
								config: {},
								sortOrder: 0,
								isDisabled: false,
								id: installation.id,
							});
							expect(
								(yield* sandbox.getScriptPin(SandboxScriptId.make(script.id), retainedPin))
									?.contentHash,
							).toBe("v1");
							yield* transaction
								.insert(tables.automationTrigger)
								.values({
									depth: 0,
									source: "api",
									payload: null,
									operation: "emit",
									category: "signal",
									id: "shared-trigger",
									occurredAt: timestamp,
									executionId: "command",
									resourceKind: "signal",
									initiatorKind: "system",
									payloadPrunedAt: timestamp,
									rootExecutionId: "command",
								});
							yield* transaction.insert(tables.automationTriggerRecipient).values([
								{ userId: "owner", triggerId: "shared-trigger" },
								{ userId: "recipient", triggerId: "shared-trigger" },
							]);
							yield* transaction
								.insert(tables.automationRun)
								.values({
									pluginId,
									stage: "after",
									delivery: "async",
									id: "retained-run",
									hookName: "Fixture",
									scriptSlug: script.slug,
									executionUserId: "owner",
									sandboxScriptId: script.id,
									triggerId: "shared-trigger",
									artifactsExpireAt: expiresAt,
									hookSlug: "fixture.automation",
									scriptContentHash: script.contentHash,
									pluginRevisionId: retainedPin.revisionId,
									pluginConfigRevisionId: retainedPin.configRevisionId,
									retryPolicy: {
										maxAttempts: 1,
										maxDelayMs: 60000,
										initialDelayMs: 1000,
										externalIdempotency: "none",
									},
								});
							yield* transaction
								.insert(tables.automationRunAttempt)
								.values({
									id: "attempt-1",
									attemptNumber: 1,
									retryable: false,
									status: "running",
									startedAt: timestamp,
									runId: "retained-run",
									workflowExecutionId: "workflow-1",
								});
							const duplicate = yield* Effect.result(
								transaction.transaction((savepoint) =>
									savepoint
										.insert(tables.automationRunAttempt)
										.values({
											id: "attempt-2",
											retryable: false,
											attemptNumber: 2,
											status: "running",
											startedAt: timestamp,
											runId: "retained-run",
											workflowExecutionId: "workflow-2",
										}),
								),
							);
							expect(Result.isFailure(duplicate)).toBe(true);
							yield* installations.remove(installation.id);
							yield* plugins.deactivate(pluginId);
							expect(yield* installations.findById(installation.id)).toBeNull();
							expect(
								(yield* sandbox.getScriptPin(SandboxScriptId.make(script.id), retainedPin))
									?.contentHash,
							).toBe("v1");
							yield* plugins.pruneRevisionArtifacts({
								limit: 500,
								now: expiresAt,
								retryWindowDays: 7,
							});
							yield* plugins.deleteUnreferencedScripts(new Set(), { limit: 500, now: expiresAt });
							expect(
								(yield* sandbox.getScriptPin(SandboxScriptId.make(script.id), retainedPin))
									?.pluginRevision?.compiledHashes["fixture.workflow"],
							).toBe("v1");
							expect(
								yield* configs.read({
									ownerUserId: "owner",
									id: retainedPin.configRevisionId,
									pluginRevisionId: retainedPin.revisionId,
								}),
							).toEqual({});
							const [persistedKey] = yield* transaction
								.select()
								.from(tables.pluginConfigEncryptionKey);
							assert(persistedKey);
							yield* transaction.delete(tables.pluginConfigEncryptionKey);
							expect(Result.isFailure(yield* Effect.result(configs.validateKeys()))).toBe(true);
							expect(yield* transaction.select().from(tables.pluginConfigEncryptionKey)).toEqual(
								[],
							);
							yield* transaction.insert(tables.pluginConfigEncryptionKey).values(persistedKey);
							expect(
								Result.isFailure(
									yield* Effect.result(
										configs.read({
											ownerUserId: "recipient",
											id: retainedPin.configRevisionId,
											pluginRevisionId: retainedPin.revisionId,
										}),
									),
								),
							).toBe(true);
							yield* transaction
								.insert(tables.sandboxScript)
								.values({
									source: "kernel",
									id: "kernel-script",
									slug: "kernel.notify",
									contentHash: "kernel",
									compiledCode: "kernel",
									name: "Kernel notification",
									metadata: {
										capabilities: [],
										kind: "automation",
										slug: "kernel.notify",
										name: "Kernel notification",
										requiredPluginConfigKeys: [],
										requiredSystemConfigKeys: [],
									},
								});
							const kernelRun = {
								id: "kernel-run",
								hookName: "Kernel",
								stage: "after" as const,
								hookSlug: "kernel.notify",
								delivery: "async" as const,
								triggerId: "shared-trigger",
								scriptSlug: "kernel.notify",
								scriptContentHash: "kernel",
								executionUserId: "recipient",
								artifactsExpireAt: expiresAt,
								sandboxScriptId: "kernel-script",
								retryPolicy: {
									maxAttempts: 1,
									maxDelayMs: 60000,
									initialDelayMs: 1000,
									externalIdempotency: "none" as const,
								},
							};
							yield* transaction.insert(tables.automationRun).values(kernelRun);
							const mixedOwnership = yield* Effect.result(
								transaction.transaction((savepoint) =>
									savepoint
										.insert(tables.automationRun)
										.values({ ...kernelRun, pluginId, id: "mixed", hookSlug: "mixed" }),
								),
							);
							expect(Result.isFailure(mixedOwnership)).toBe(true);
							const duplicateKernel = yield* Effect.result(
								transaction.transaction((savepoint) =>
									savepoint
										.insert(tables.automationRun)
										.values({ ...kernelRun, id: "duplicate-kernel" }),
								),
							);
							expect(Result.isFailure(duplicateKernel)).toBe(true);
							yield* transaction
								.update(tables.automationRunAttempt)
								.set({ status: "succeeded", finishedAt: timestamp });
							yield* transaction
								.update(tables.automationRun)
								.set({ status: "succeeded", artifactsExpireAt: expiredAt })
								.where(eq(tables.automationRun.id, "retained-run"));
							yield* plugins.pruneRevisionArtifacts({
								limit: 500,
								now: expiresAt,
								retryWindowDays: 7,
							});
							expect(
								Result.isFailure(
									yield* Effect.result(
										configs.read({
											ownerUserId: "owner",
											id: retainedPin.configRevisionId,
											pluginRevisionId: retainedPin.revisionId,
										}),
									),
								),
							).toBe(true);
							expect((yield* transaction.select().from(tables.pluginRevision)).length).toBe(2);
							yield* plugins.deleteUnreferencedScripts(new Set(), { limit: 500, now: expiresAt });
							expect(
								yield* transaction
									.select()
									.from(tables.sandboxScript)
									.where(
										and(
											eq(tables.sandboxScript.pluginRevisionId, retainedPin.revisionId),
											eq(tables.sandboxScript.slug, "fixture.workflow"),
										),
									),
							).toEqual([]);
							yield* transaction.delete(tables.user).where(eq(tables.user.id, "owner"));
							expect(
								yield* transaction
									.select({ id: tables.automationRun.id })
									.from(tables.automationRun),
							).toEqual([{ id: "kernel-run" }]);
							expect(yield* transaction.select().from(tables.automationRunAttempt)).toEqual([]);
							expect(yield* transaction.select().from(tables.pluginConfigRevision)).toEqual([]);
							expect(yield* transaction.select().from(tables.automationTriggerRecipient)).toEqual([
								{ userId: "recipient", triggerId: "shared-trigger" },
							]);
							expect((yield* transaction.select().from(tables.automationTrigger)).length).toBe(1);
							const environmentPackage = {
								...packageAt("environment-v1"),
								manifest: {
									...manifest,
									configSchema: {
										unknownKeys: "strict" as const,
										fields: {
											token: {
												label: "Token",
												secret: true as const,
												type: "string" as const,
												description: "Environment token",
												validation: { required: true as const },
											},
										},
									},
								},
							};
							yield* plugins
								.persist(environmentPackage, { ownerId: null, scope: "system", slug: "fixture" })
								.pipe(Effect.provide(environment("environment-secret")));
							expect(yield* transaction.select().from(tables.pluginConfigRevision)).toEqual([]);
							const environmentPointer = transaction
								.select()
								.from(tables.plugin)
								.pipe(Effect.map(([row]) => row?.environmentConfigRevisionId));
							yield* plugins
								.resolveEnvironmentConfigs()
								.pipe(Effect.provide(environment("environment-secret")));
							const configRevisionId = yield* environmentPointer;
							assert(configRevisionId);
							const [configRevision] = yield* transaction
								.select()
								.from(tables.pluginConfigRevision)
								.where(eq(tables.pluginConfigRevision.id, configRevisionId));
							const [systemPlugin] = yield* transaction.select().from(tables.plugin);
							expect(configRevision?.pluginRevisionId).toBe(systemPlugin?.activeRevisionId);
							yield* plugins
								.resolveEnvironmentConfigs()
								.pipe(Effect.provide(environment("environment-secret")));
							expect(yield* environmentPointer).toBe(configRevisionId);
							expect(yield* transaction.select().from(tables.pluginConfigRevision)).toHaveLength(1);
							yield* plugins
								.resolveEnvironmentConfigs()
								.pipe(Effect.provide(environment("different-secret")));
							const replacedConfigRevisionId = yield* environmentPointer;
							expect(replacedConfigRevisionId).not.toBe(configRevisionId);
							expect(yield* transaction.select().from(tables.pluginConfigRevision)).toHaveLength(2);
							const missingEnvironment = yield* Effect.result(
								transaction.transaction((savepoint) =>
									plugins
										.resolveEnvironmentConfigs()
										.pipe(
											Effect.provideService(Database, savepoint),
											Effect.provide(makeConfigProviderLayer()),
										),
								),
							);
							expect(Result.isFailure(missingEnvironment)).toBe(true);
							yield* plugins.pruneRevisionArtifacts({
								limit: 500,
								now: expiresAt,
								retryWindowDays: 0,
							});
							expect(
								(yield* transaction.select().from(tables.pluginConfigRevision)).map(
									({ id, encryptedPayload }) => [id, encryptedPayload === null],
								),
							).toEqual(
								expect.arrayContaining([
									[configRevisionId, false],
									[replacedConfigRevisionId, false],
								]),
							);
							return yield* new RollbackValidation();
						}).pipe(Effect.provideService(Database, transaction)),
					)
					.pipe(Effect.catchTag("RollbackValidation", () => Effect.void));
			}).pipe(
				Effect.provide(services.pipe(Layer.provideMerge(DatabaseLive), Layer.provide(config))),
			),
	);
});
