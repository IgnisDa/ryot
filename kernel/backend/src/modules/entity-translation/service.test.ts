import { expect, layer } from "@effect/vitest";
import { DbError, SandboxRunError } from "@ryot-app/contract/errors";
import { EntityId, PluginId } from "@ryot-app/contract/schema/brands";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Exit, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import { fakeDatabaseSession, makeWorkflowEngine } from "#lib/test-utils/effect";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { TranslationsRepository, type TranslationOverlayInput } from "./repository";
import { TranslationsService } from "./service";
import {
	translationExecution as execution,
	translationPayload as payload,
} from "./translation.test-support";

const overlay = {
	name: "Libro",
	language: payload.language,
	entityId: payload.entityId,
	properties: { title: "Libro" },
	populatedAt: new Date("2026-07-16T00:00:00.000Z"),
} satisfies TranslationOverlayInput;
const storedAt = new Date(0);

type ExecuteOptions = Parameters<WorkflowEngine["Service"]["execute"]>[1];
class TranslationEffects extends Context.Service<
	TranslationEffects,
	{
		readonly executions: Effect.Effect<ReadonlyArray<ExecuteOptions>>;
		readonly installationOwners: Effect.Effect<ReadonlyArray<ReadonlyArray<unknown>>>;
		readonly upserts: Effect.Effect<ReadonlyArray<TranslationOverlayInput>>;
		readonly quarantine: Effect.Effect<void>;
	}
>()("test/TranslationEffects") {}

const dialect = new PgDialect();

const makeServiceLayer = (
	options: {
		foreignProvider?: boolean;
		globalEntity?: boolean;
		systemPlugin?: boolean;
		enqueueFailure?: boolean;
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const executions = yield* Ref.make<ReadonlyArray<ExecuteOptions>>([]);
			const installationOwners = yield* Ref.make<ReadonlyArray<ReadonlyArray<unknown>>>([]);
			const upserts = yield* Ref.make<ReadonlyArray<TranslationOverlayInput>>([]);
			const quarantined = yield* Ref.make(false);
			const principal = options.systemPlugin
				? {
						...execution.principal,
						pluginRevision: {
							...execution.principal.pluginRevision,
							ownerId: null,
							scope: "system" as const,
						},
					}
				: execution.principal;
			const manifest = fixtureManifest(execution.principal.pluginRevision.packageId);
			const storedManifest = {
				...manifest,
				metadata: { ...manifest.metadata, slug: execution.principal.pluginRevision.slug },
			};
			const sandboxAuthority = {
				packageId: execution.principal.pluginRevision.packageId,
				schemaScope: execution.principal.pluginRevision.schemaScope,
				configSchema: execution.principal.pluginRevision.configSchema,
				workflowScripts: execution.principal.pluginRevision.workflowScripts,
				scriptKinds: { [execution.principal.scriptSlug]: execution.principal.metadata.kind },
				userBootstrapScriptSlugs: execution.principal.pluginRevision.userBootstrapScriptSlugs,
			};
			const db = {
				execute: () => Effect.void,
				select: (selection?: Record<string, unknown>) => ({
					from: (table: unknown) => {
						let predicate: SQLWrapper | undefined;
						const scriptList =
							table === tables.sandboxScript &&
							Object.keys(selection ?? {}).length === 2 &&
							"contentHash" in (selection ?? {});
						const rows = Effect.gen(function* () {
							if (table === tables.sandboxScript && scriptList) {
								return [
									{
										slug: execution.principal.scriptSlug,
										contentHash: execution.principal.contentHash,
									},
								];
							}
							if (table === tables.sandboxScript) {
								return [
									{
										kernelSlug: null,
										sandboxAuthority,
										sourcePresent: true,
										pluginStatus: "active",
										id: execution.principal.scriptId,
										slug: execution.principal.scriptSlug,
										pluginId: principal.pluginRevision.id,
										metadata: execution.principal.metadata,
										activationId: "existing-principal-state",
										pluginSlug: principal.pluginRevision.slug,
										providerId: execution.principal.providerId,
										contentHash: execution.principal.contentHash,
										providerPluginId: principal.pluginRevision.id,
										pluginOwnerId: principal.pluginRevision.ownerId,
										pluginPackageId: principal.pluginRevision.packageId,
										activeRevisionId: principal.pluginRevision.revisionId,
										pluginRevisionId: principal.pluginRevision.revisionId,
										manifestPackageId: principal.pluginRevision.packageId,
										environmentConfigRevisionId: principal.pluginRevision.configRevisionId,
									},
								];
							}
							if (table === tables.pluginRevision) {
								return [{ manifest: storedManifest }];
							}
							if (table === tables.pluginInstallation) {
								return [
									{
										isHidden: false,
										disabledAt: null,
										uninstalledAt: null,
										isInitialized: true,
										ingestionRetiring: false,
										id: "existing-installation",
										activationId: "existing-principal-state",
										health: (yield* Ref.get(quarantined)) ? "incompatible" : "ready",
										activeConfigRevisionId: principal.pluginRevision.configRevisionId,
										incompatibilityReason: (yield* Ref.get(quarantined))
											? "package-identity-conflict"
											: null,
									},
								];
							}
							if (table === tables.user) {
								return [
									{
										disabledAt: null,
										token: payload.accountGeneration.token,
										accountGeneration: payload.accountGeneration.token,
									},
								];
							}
							if (table === tables.pluginConfigRevision) {
								return [
									{
										encryptedPayload: "encrypted-config",
										ownerUserId: principal.pluginRevision.ownerId,
										pluginRevisionId: principal.pluginRevision.revisionId,
									},
								];
							}
							if (table === tables.sandboxProvider) {
								return [
									{
										slug: "catalog",
										id: payload.providerId,
										pluginId: payload.entitySchemaPluginId,
										rootEntitySchemaSlug: payload.entitySchemaSlug,
									},
								];
							}
							return [];
						});
						const query = {
							innerJoin: () => query,
							where: (condition: SQLWrapper) => {
								predicate = condition;
								return scriptList ? rows : query;
							},
							limit: () => {
								const selectedRows =
									table === tables.pluginInstallation
										? Ref.update(installationOwners, (all) => [
												...all,
												predicate ? dialect.sqlToQuery(predicate.getSQL()).params : [],
											]).pipe(Effect.andThen(rows))
										: rows;
								return Object.assign(selectedRows, { for: () => selectedRows });
							},
						};
						return query;
					},
				}),
			};
			const database = fakeDatabaseSession(db);
			const storedEntity = {
				name: "Record",
				createdAt: storedAt,
				updatedAt: storedAt,
				id: payload.entityId,
				populatedAt: storedAt,
				providerId: payload.providerId,
				externalId: payload.externalId,
				properties: execution.properties,
				entitySchemaSlug: payload.entitySchemaSlug,
				entitySchemaPluginId: payload.entitySchemaPluginId,
				userId: options.globalEntity ? null : payload.userId,
			};
			const repository = Layer.mock(TranslationsRepository)({
				requireActiveAccount: () => Effect.void,
				findEntityById: () => Effect.succeed(storedEntity),
				findEntityForUser: () => Effect.succeed(storedEntity),
				lockActivePluginOwner: () => Effect.succeed({ ownerId: principal.pluginRevision.ownerId }),
				upsertOverlay: (input) =>
					Ref.update(upserts, (all) => [...all, input]).pipe(
						Effect.as({ entityId: input.entityId, language: input.language }),
					),
			});
			const runtime = Layer.mock(PluginRuntimeResolver)({
				lockCatalog: () => Effect.void,
				resolveUserTranslateScript: () =>
					Effect.succeed({
						slug: "translate",
						name: "Translate",
						optionsSchema: null,
						providerId: payload.providerId,
						id: execution.principal.scriptId,
						metadata: execution.principal.metadata,
						pluginId: payload.entitySchemaPluginId,
						contentHash: execution.principal.contentHash,
						pluginRevisionId: execution.principal.pluginRevision.revisionId,
					}),
				findProviderAvailableToUser: () =>
					Effect.succeed({
						slug: "catalog",
						name: "Catalog",
						pluginScope: "user",
						id: payload.providerId,
						createdAt: new Date(0),
						updatedAt: new Date(0),
						rootEntitySchemaSlug: payload.entitySchemaSlug,
						information: { source: "Test", canonicalLanguage: "en" },
						pluginId: options.foreignProvider ? "foreign-plugin" : payload.entitySchemaPluginId,
					}),
				findPluginAvailableToUser: () =>
					Ref.get(quarantined).pipe(
						Effect.map((unavailable) =>
							unavailable
								? null
								: {
										isHidden: false,
										clientImports: [],
										healthReason: null,
										compiledHashes: {},
										sourceHash: "source",
										scope: "user" as const,
										health: "ready" as const,
										slug: "translation-plugin",
										ownerUserId: payload.userId,
										manifest: fixtureManifest(),
										incompatibilityReason: null,
										installationId: "installation",
										id: payload.entitySchemaPluginId,
										packageId: execution.principal.pluginRevision.packageId,
										pluginRevisionId: execution.principal.pluginRevision.revisionId,
										pluginConfigRevisionId: execution.principal.pluginRevision.configRevisionId,
									},
						),
					),
			});
			const sandbox = Layer.effect(
				SandboxExecutionService,
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					return yield* Effect.succeed(
						SandboxExecutionService.of({
							enqueue: () => Effect.die("unused"),
							getResult: () => Effect.die("unused"),
							executeScript: () => Effect.die("unused"),
							executeWorkflow: () => Effect.die("unused"),
							releaseWorkflowRegistration: () => Effect.void,
							resolveWorkflowScript: () => Effect.die("unused"),
							enqueuePluginWorkflow: () => Effect.die("unused"),
							getPluginWorkflowResult: () => Effect.die("unused"),
							preRegisterPluginWorkflow: (input) =>
								session
									.transaction(
										(input.retain ? input.retain(principal) : Effect.void).pipe(
											Effect.as({
												principal,
												pluginRevision: principal.pluginRevision,
												registrationStatus: "registered" as const,
											}),
										),
									)
									.pipe(
										Effect.mapError((error) =>
											error instanceof SandboxRunError
												? error
												: new SandboxRunError({ kind: "infrastructure", message: error.message }),
										),
									),
						}),
					);
				}),
			).pipe(Layer.provide(database));
			return TranslationsService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						database,
						repository,
						runtime,
						sandbox,
						Layer.succeed(
							WorkflowEngine,
							makeWorkflowEngine({
								execute: (_workflow, input) =>
									Ref.update(executions, (all) => [...all, input]).pipe(
										Effect.andThen(
											options.enqueueFailure ? Effect.die("enqueue failed") : Effect.void,
										),
									),
							}),
						),
						Layer.succeed(TranslationEffects, {
							upserts: Ref.get(upserts),
							executions: Ref.get(executions),
							quarantine: Ref.set(quarantined, true),
							installationOwners: Ref.get(installationOwners),
						}),
					),
				),
			);
		}),
	);

layer(makeServiceLayer())((test) => {
	test.effect("preserves provider owner and restricted caller context when enqueueing", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			const command = { ...payload.command, writeContext: execution.principal };
			yield* service.requestFill({ ...payload, command });
			expect(yield* (yield* TranslationEffects).executions).toMatchObject([
				{
					discard: true,
					executionId: "translate-entity-1-es",
					payload: {
						command,
						providerId: payload.providerId,
						entitySchemaPluginId: payload.entitySchemaPluginId,
					},
				},
			]);
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"captures private translation from the actual populated owner scope and stored properties",
		() =>
			Effect.gen(function* () {
				const service = yield* TranslationsService;
				const captured = yield* service.admitExecution(payload, payload.executionId);
				expect(captured).toEqual(execution);
				yield* service.upsert(overlay, payload, captured);
				expect(yield* (yield* TranslationEffects).upserts).toEqual([overlay]);
				const owners = yield* (yield* TranslationEffects).installationOwners;
				expect(owners.length).toBeGreaterThan(0);
				for (const owner of owners) {
					expect(owner).toContain(execution.principal.pluginRevision.id);
					expect(owner).toContain(payload.userId);
				}
			}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("rejects quarantine after execution before overlay commit", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			const captured = yield* service.admitExecution(payload, payload.executionId);
			yield* (yield* TranslationEffects).quarantine;
			assertExitFails(
				yield* Effect.exit(service.upsert(overlay, payload, captured)),
				new DbError({ message: "Current domain write installation authority is unavailable" }),
			);
			expect(yield* (yield* TranslationEffects).upserts).toEqual([]);
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("rejects committing an overlay to a different entity ID", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			const captured = yield* service.admitExecution(payload, payload.executionId);
			expect(
				yield* Effect.exit(
					service.upsert(
						{ ...overlay, entityId: EntityId.make("foreign-entity") },
						payload,
						captured,
					),
				),
			).toSatisfy(Exit.isFailure);
			expect(yield* (yield* TranslationEffects).upserts).toEqual([]);
		}),
	);
});

layer(makeServiceLayer({ foreignProvider: true }))((test) => {
	test.effect("rejects a foreign same-schema provider at capture", () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* Effect.exit(
					(yield* TranslationsService).admitExecution(payload, payload.executionId),
				),
				new SandboxRunError({
					kind: "invalid-input",
					message: "Translation entity or provider identity is unavailable",
				}),
			);
			expect(yield* (yield* TranslationEffects).upserts).toEqual([]);
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("retains a plugin caller's owner restriction at translation admission", () =>
		Effect.gen(function* () {
			const caller = {
				...execution.principal,
				pluginRevision: {
					...execution.principal.pluginRevision,
					id: PluginId.make("foreign-plugin"),
				},
			};
			expect(
				yield* Effect.exit(
					(yield* TranslationsService).admitExecution(
						{ ...payload, command: { ...payload.command, writeContext: caller } },
						payload.executionId,
					),
				),
			).toSatisfy(Exit.isFailure);
			expect(yield* (yield* TranslationEffects).upserts).toEqual([]);
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"allows a kernel manual overlay in the stored private scope without executing plugin code",
		() =>
			Effect.gen(function* () {
				expect(
					yield* (yield* TranslationsService).upsertKernelOverlay(overlay, payload.command),
				).toEqual({ entityId: payload.entityId, language: payload.language });
				expect(yield* (yield* TranslationEffects).upserts).toEqual([overlay]);
			}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("does not let a manual kernel overlay bypass private quarantine", () =>
		Effect.gen(function* () {
			yield* (yield* TranslationEffects).quarantine;
			expect(
				yield* Effect.exit(
					(yield* TranslationsService).upsertKernelOverlay(overlay, payload.command),
				),
			).toSatisfy(Exit.isFailure);
			expect(yield* (yield* TranslationEffects).upserts).toEqual([]);
		}),
	);
});

layer(makeServiceLayer({ globalEntity: true }))((test) => {
	test.effect("rejects a private translation for a global entity", () =>
		Effect.gen(function* () {
			expect(
				yield* Effect.exit(
					(yield* TranslationsService).admitExecution(payload, payload.executionId),
				),
			).toSatisfy(Exit.isFailure);
		}),
	);
});

layer(makeServiceLayer({ globalEntity: true, systemPlugin: true }))((test) => {
	test.effect(
		"keeps shared system translations global and commits their negative-cache overlay",
		() =>
			Effect.gen(function* () {
				const service = yield* TranslationsService;
				const captured = yield* service.admitExecution(payload, payload.executionId);
				expect(captured.entityScopeUserId).toBeNull();
				expect(captured.principal.pluginRevision?.scope).toBe("system");
				const negativeOverlay = { ...overlay, name: null, properties: null };
				yield* service.upsert(negativeOverlay, payload, captured);
				expect(yield* (yield* TranslationEffects).upserts).toEqual([negativeOverlay]);
			}),
	);
});

layer(makeServiceLayer({ enqueueFailure: true }))((test) => {
	test.effect("keeps the deterministic ID and exposes enqueue failure", () =>
		Effect.gen(function* () {
			expect(yield* Effect.exit((yield* TranslationsService).requestFill(payload))).toSatisfy(
				Exit.isFailure,
			);
			expect(
				(yield* (yield* TranslationEffects).executions).map(({ executionId }) => executionId),
			).toEqual(["translate-entity-1-es"]);
		}),
	);
});
