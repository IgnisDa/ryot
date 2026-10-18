import { assert, expect, layer } from "@effect/vitest";
import { DbError, SandboxRunError } from "@ryot-app/contract/errors";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Exit, Layer, Ref, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { DefinitionRepository } from "#modules/definitions/repository";
import type { EnrichmentRequestInput } from "#modules/entities/enrichment/repository";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { fakeDatabaseSession, makeWorkflowEngine } from "#testing/effect";

import {
	translateEntityExecutionId,
	TranslateEntityWorkflowPayload,
} from "./entity-translation-workflow";
import { type TranslationOverlayInput, TranslationsRepository } from "./repository";
import { TranslationsService } from "./service";
import {
	translationExecution as execution,
	translationPayload as payload,
	translationRequestRow,
} from "./translation.test-support";

const overlay = {
	name: "Libro",
	language: payload.language,
	entityId: payload.entityId,
	sourceContentGeneration: 1,
	properties: { title: "Libro" },
	populatedAt: new Date("2026-07-16T00:00:00.000Z"),
} satisfies TranslationOverlayInput;
const storedAt = new Date(0);
const assetLocator = { type: "s3" as const, key: "permanent/translation-image.png" };
const assetOverlay = { ...overlay, properties: { title: "Libro", image: assetLocator } };

const translationManifest = () => {
	const manifest = fixtureManifest();
	for (const entitySchema of manifest.entitySchemas) {
		entitySchema.slug = payload.entitySchemaSlug;
	}
	return manifest;
};

type ExecuteOptions = Parameters<WorkflowEngine["Service"]["execute"]>[1];
class TranslationEffects extends Context.Service<
	TranslationEffects,
	{
		readonly executions: Effect.Effect<ReadonlyArray<ExecuteOptions>>;
		readonly admissions: Effect.Effect<ReadonlyArray<EnrichmentRequestInput>>;
		readonly installationOwners: Effect.Effect<ReadonlyArray<ReadonlyArray<unknown>>>;
		readonly upserts: Effect.Effect<ReadonlyArray<TranslationOverlayInput>>;
		readonly quarantine: Effect.Effect<void>;
		readonly changeContent: Effect.Effect<void>;
		readonly pinnedPayload: Effect.Effect<TranslateEntityWorkflowPayload>;
		readonly upgrade: Effect.Effect<void>;
		readonly registrations: Effect.Effect<ReadonlyArray<string>>;
		readonly released: Effect.Effect<ReadonlyArray<string>>;
		readonly startRequest: Effect.Effect<void>;
		readonly finishRequest: Effect.Effect<void>;
	}
>()("test/TranslationEffects") {}

const pinnedPayload = Effect.flatMap(TranslationEffects, (effects) => effects.pinnedPayload);

const dialect = new PgDialect();

const makeServiceLayer = (
	options: {
		assetOwnerUserId?: string;
		foreignProvider?: boolean;
		globalEntity?: boolean;
		systemPlugin?: boolean;
		enqueueFailure?: boolean;
		rootSchemaSlug?: string;
		selectedKeys?: readonly string[];
		storedProperties?: Record<string, unknown>;
		storedName?: string;
		unsupportedSchema?: boolean;
		requestState?: "queued" | "succeeded";
		reusedRetry?: boolean;
		requestFailure?: boolean;
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const entitySchema = translationManifest().entitySchemas[0];
			assert(entitySchema);
			const executions = yield* Ref.make<ReadonlyArray<ExecuteOptions>>([]);
			const admissions = yield* Ref.make<ReadonlyArray<EnrichmentRequestInput>>([]);
			const requests = yield* Ref.make<
				ReadonlyArray<typeof tables.entityEnrichmentRequest.$inferSelect>
			>([]);
			const registrations = yield* Ref.make<ReadonlyArray<string>>([]);
			const released = yield* Ref.make<ReadonlyArray<string>>([]);
			const installationOwners = yield* Ref.make<ReadonlyArray<ReadonlyArray<unknown>>>([]);
			const upserts = yield* Ref.make<ReadonlyArray<TranslationOverlayInput>>([]);
			const quarantined = yield* Ref.make(false);
			const contentGeneration = yield* Ref.make(1);
			const basePrincipal = {
				...execution.principal,
				metadata: {
					...execution.principal.metadata,
					translationInputs: {
						[options.unsupportedSchema ? "another-record" : payload.entitySchemaSlug]:
							options.selectedKeys ?? ["title"],
					},
				},
			};
			const principal = options.systemPlugin
				? {
						...basePrincipal,
						pluginRevision: {
							...execution.principal.pluginRevision,
							ownerId: null,
							scope: "system" as const,
						},
					}
				: basePrincipal;
			const activePrincipal = yield* Ref.make(principal);
			const upgrade = Ref.set(activePrincipal, {
				...principal,
				scriptId: SandboxScriptId.make("upgraded-translation-script"),
				metadata: { ...principal.metadata, translationInputs: { record: [] } },
				pluginRevision: {
					...principal.pluginRevision,
					revisionId: PluginRevisionId.make("upgraded-translation-revision"),
					configRevisionId: PluginConfigRevisionId.make("upgraded-translation-config"),
				},
			});
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
				select: () => ({
					from: (table: unknown) => {
						let predicate: SQLWrapper | undefined;
						const rows = Effect.gen(function* () {
							if (table === tables.sandboxScript) {
								const quarantine = yield* Ref.get(quarantined);
								const current = yield* Ref.get(activePrincipal);
								return [
									{
										kernelSlug: null,
										sandboxAuthority,
										sourcePresent: true,
										pluginStatus: "active",
										accountDisabledAt: null,
										accountId: payload.userId,
										configPayloadPresent: true,
										installationIsHidden: false,
										installationDisabledAt: null,
										metadata: principal.metadata,
										installationIsInitialized: true,
										installationUninstalledAt: null,
										id: execution.principal.scriptId,
										installationUserId: payload.userId,
										slug: execution.principal.scriptSlug,
										pluginId: principal.pluginRevision.id,
										installationId: "existing-installation",
										activationId: "existing-principal-state",
										providerId: execution.principal.providerId,
										contentHash: execution.principal.contentHash,
										providerPluginId: principal.pluginRevision.id,
										pluginOwnerId: principal.pluginRevision.ownerId,
										accountGeneration: payload.accountGeneration.token,
										configId: principal.pluginRevision.configRevisionId,
										configOwnerUserId: principal.pluginRevision.ownerId,
										pluginPackageId: principal.pluginRevision.packageId,
										activeRevisionId: current.pluginRevision.revisionId,
										pluginRevisionId: principal.pluginRevision.revisionId,
										installationHealth: quarantine ? "incompatible" : "ready",
										configPluginRevisionId: principal.pluginRevision.revisionId,
										environmentConfigRevisionId: current.pluginRevision.configRevisionId,
										installationActiveConfigRevisionId: current.pluginRevision.configRevisionId,
										installationIncompatibilityReason: quarantine
											? "package-identity-conflict"
											: null,
										compiledHashes: {
											[execution.principal.scriptSlug]: execution.principal.contentHash,
										},
									},
								];
							}
							if (table === tables.pluginRevision) {
								return [{ id: principal.pluginRevision.revisionId }];
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
							if (table === tables.managedAsset) {
								return [
									{
										retiredAt: null,
										key: assetLocator.key,
										provider: assetLocator.type,
										ownerUserId: options.assetOwnerUserId ?? payload.userId,
									},
								];
							}
							if (table === tables.sandboxProvider) {
								return [
									{
										slug: "catalog",
										id: payload.providerId,
										pluginId: payload.entitySchemaPluginId,
										rootEntitySchemaSlug: options.rootSchemaSlug ?? payload.entitySchemaSlug,
									},
								];
							}
							return [];
						});
						const query = {
							leftJoin: () => query,
							innerJoin: () => query,
							orderBy: () => ({ for: () => rows }),
							where: (condition: SQLWrapper) => {
								predicate = condition;
								return query;
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
				createdAt: storedAt,
				updatedAt: storedAt,
				id: payload.entityId,
				contentGeneration: 1,
				populatedAt: storedAt,
				relatedPopulatedAt: null,
				providerId: payload.providerId,
				externalId: payload.externalId,
				relatedPopulationStartedAt: null,
				relatedPopulationGeneration: null,
				name: options.storedName ?? execution.name,
				entitySchemaSlug: payload.entitySchemaSlug,
				entitySchemaPluginId: payload.entitySchemaPluginId,
				userId: options.globalEntity ? null : payload.userId,
				properties: options.storedProperties ?? {
					...execution.properties,
					largeUnselected: "x".repeat(100_000),
				},
			};
			const repository = Layer.mock(TranslationsRepository)({
				findEntityById: () =>
					Ref.get(contentGeneration).pipe(
						Effect.map((generation) => ({ ...storedEntity, contentGeneration: generation })),
					),
				findEntityForUser: () =>
					Ref.get(contentGeneration).pipe(
						Effect.map((generation) => ({ ...storedEntity, contentGeneration: generation })),
					),
				upsertOverlay: (input) =>
					Ref.update(upserts, (all) => [...all, input]).pipe(
						Effect.as({ entityId: input.entityId, language: input.language }),
					),
			});
			const runtime = Layer.mock(PluginRuntimeResolver)({
				lockCatalog: () => Effect.void,
				resolveUserTranslateScript: () =>
					Ref.get(activePrincipal).pipe(
						Effect.map((active) => ({
							slug: "translate",
							name: "Translate",
							optionsSchema: null,
							id: active.scriptId,
							metadata: active.metadata,
							providerId: payload.providerId,
							pluginId: payload.entitySchemaPluginId,
							contentHash: execution.principal.contentHash,
							pluginRevisionId: active.pluginRevision.revisionId,
						})),
					),
				findProviderAvailableToUser: () =>
					Effect.succeed({
						slug: "catalog",
						name: "Catalog",
						pluginScope: "user",
						id: payload.providerId,
						createdAt: new Date(0),
						updatedAt: new Date(0),
						information: { source: "Test", canonicalLanguage: "en" },
						rootEntitySchemaSlug: options.rootSchemaSlug ?? payload.entitySchemaSlug,
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
										contentHash: "source",
										scope: "user" as const,
										health: "ready" as const,
										slug: "translation-plugin",
										ownerUserId: payload.userId,
										incompatibilityReason: null,
										installationId: "installation",
										manifest: translationManifest(),
										id: payload.entitySchemaPluginId,
										packageId: execution.principal.pluginRevision.packageId,
										pluginRevisionId: execution.principal.pluginRevision.revisionId,
										pluginConfigRevisionId: execution.principal.pluginRevision.configRevisionId,
									},
						),
					),
			});
			const sandbox = Layer.effect(
				ScriptExecutionService,
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					return yield* Effect.succeed(
						ScriptExecutionService.of({
							enqueue: () => Effect.die("unused"),
							getResult: () => Effect.die("unused"),
							executeScript: () => Effect.die("unused"),
							executeWorkflow: () => Effect.die("unused"),
							resolveWorkflowScript: () => Effect.die("unused"),
							enqueuePluginWorkflow: () => Effect.die("unused"),
							getPluginWorkflowResult: () => Effect.die("unused"),
							releaseWorkflowRegistration: (id) => Ref.update(released, (all) => [...all, id]),
							preRegisterPluginWorkflow: (input) =>
								session
									.transaction(
										Effect.gen(function* () {
											const current = yield* Ref.get(activePrincipal);
											if (input.retain) {
												yield* input.retain(current);
											}
											yield* Ref.update(registrations, (all) => [...all, input.executionId]);
											return {
												principal: current,
												pluginRevision: current.pluginRevision,
												registrationStatus: "registered" as const,
											};
										}),
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
						Layer.mock(EnrichmentRequests)({
							lockTarget: () => Effect.void,
							get: (id) =>
								Ref.get(requests).pipe(
									Effect.map((rows) => rows.find((row) => row.id === id) ?? null),
								),
							ensure: (input) =>
								Effect.gen(function* () {
									yield* Ref.update(admissions, (all) => [...all, input]);
									if (options.requestFailure) {
										return yield* new SandboxRunError({
											kind: "infrastructure",
											message: "Admission failed",
										});
									}
									const row = {
										...translationRequestRow(input),
										state: options.requestState ?? "queued",
										id: options.reusedRetry ? "prior-retry" : input.id,
									} satisfies typeof tables.entityEnrichmentRequest.$inferSelect;
									yield* Ref.update(requests, (rows) => [...rows, row]);
									return row;
								}),
						}),
						Layer.mock(DefinitionRepository, {
							findUserEntitySchemas: () =>
								Effect.succeed({
									[definitionKey(
										"entity",
										definitionOwner(payload.entitySchemaPluginId),
										payload.entitySchemaSlug,
									)]: {
										icon: "book",
										eventSchemas: {},
										name: entitySchema.name,
										mergeIdentityProperties: [],
										slug: payload.entitySchemaSlug,
										pluginId: payload.entitySchemaPluginId,
										propertiesSchema: {
											fields: {
												...entitySchema.propertiesSchema.fields,
												image: {
													type: "object",
													properties: {},
													label: "Image",
													description: "Image",
													validation: { asset: true },
												},
											},
										},
									},
								}),
						}),
						DomainWriteChecksLive.pipe(Layer.provide(database)),
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
							upgrade,
							upserts: Ref.get(upserts),
							released: Ref.get(released),
							admissions: Ref.get(admissions),
							executions: Ref.get(executions),
							registrations: Ref.get(registrations),
							quarantine: Ref.set(quarantined, true),
							installationOwners: Ref.get(installationOwners),
							changeContent: Ref.update(contentGeneration, (generation) => generation + 1),
							startRequest: Ref.update(requests, (rows) =>
								rows.map((row) => ({ ...row, state: "running" as const })),
							),
							finishRequest: Ref.update(requests, (rows) =>
								rows.map((row) => ({ ...row, state: "succeeded" as const })),
							),
							pinnedPayload: Effect.succeed({
								...payload,
								principal,
								entityScopeUserId: options.globalEntity ? null : payload.entityScopeUserId,
							}),
						}),
					),
				),
			);
		}),
	);

layer(makeServiceLayer())((test) => {
	test.effect("enqueues with the provider owner and an unrestricted user command", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			yield* service.requestFill(payload);
			expect(yield* (yield* TranslationEffects).executions).toMatchObject([
				{
					discard: true,
					executionId: translateEntityExecutionId(payload),
					payload: {
						providerId: payload.providerId,
						command: { writeContext: null },
						entitySchemaPluginId: payload.entitySchemaPluginId,
					},
				},
			]);
			const [admission] = yield* (yield* TranslationEffects).admissions;
			expect(admission).toMatchObject({
				dispatchRoot: true,
				sourceContentGeneration: 1,
				scopeUserId: payload.userId,
			});
			expect(admission?.payload).not.toHaveProperty("properties");
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"captures private translation from the actual populated owner scope and stored properties",
		() =>
			Effect.gen(function* () {
				const service = yield* TranslationsService;
				const captured = yield* service.admitExecution(yield* pinnedPayload);
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
			const captured = yield* service.admitExecution(yield* pinnedPayload);
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
			const captured = yield* service.admitExecution(yield* pinnedPayload);
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
				yield* Effect.exit((yield* TranslationsService).admitExecution(yield* pinnedPayload)),
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
					(yield* TranslationsService).admitExecution({
						...(yield* pinnedPayload),
						command: { ...payload.command, writeContext: caller },
					}),
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
				yield* Effect.exit((yield* TranslationsService).admitExecution(yield* pinnedPayload)),
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
				const globalPayload = yield* pinnedPayload;
				const captured = yield* service.admitExecution(globalPayload);
				expect(captured.entityScopeUserId).toBeNull();
				expect(captured.principal.pluginRevision?.scope).toBe("system");
				const negativeOverlay = { ...overlay, name: null, properties: null };
				yield* service.upsert(negativeOverlay, globalPayload, captured);
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
			).toEqual([translateEntityExecutionId(payload)]);
			expect(yield* (yield* TranslationEffects).released).toEqual([]);
			expect((yield* (yield* TranslationEffects).admissions)[0]?.payload).toMatchObject({
				principal: execution.principal,
			});
		}),
	);
});

layer(makeServiceLayer({ rootSchemaSlug: "parent-record" }))((test) => {
	test.effect("authorizes a declared child schema without requiring the provider root", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			const captured = yield* service.admitExecution(yield* pinnedPayload);
			expect(captured.properties).toEqual({ title: "Stored Record" });
			yield* service.upsert(overlay, payload, captured);
			expect(yield* (yield* TranslationEffects).upserts).toEqual([overlay]);
		}),
	);
});

layer(makeServiceLayer({ selectedKeys: [] }))((test) => {
	test.effect("captures no canonical properties for an empty selection", () =>
		Effect.gen(function* () {
			const captured = yield* (yield* TranslationsService).admitExecution(yield* pinnedPayload);
			expect(captured.properties).toEqual({});
			expect(captured.name).toBe(execution.name);
			expect(captured.contentGeneration).toBe(1);
		}),
	);
});

layer(makeServiceLayer({ unsupportedSchema: true }))((test) => {
	test.effect("rejects an undeclared schema even when it is the provider root", () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* Effect.exit((yield* TranslationsService).admitExecution(yield* pinnedPayload)),
				new SandboxRunError({
					kind: "invalid-input",
					message: "Translation entity or provider identity is unavailable",
				}),
			);
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"uses a new initial identity for changed canonical content and account generations",
		() =>
			Effect.gen(function* () {
				const service = yield* TranslationsService;
				const effects = yield* TranslationEffects;
				expect(yield* service.requestFill(payload)).toBe(true);
				yield* effects.changeContent;
				expect(yield* service.requestFill(payload)).toBe(true);
				expect(
					yield* service.requestFill({
						...payload,
						accountGeneration: { ...payload.accountGeneration, token: "new-generation" },
					}),
				).toBe(true);
				const ids = (yield* effects.executions).map(({ executionId }) => executionId);
				expect(new Set(ids).size).toBe(3);
				expect(
					(yield* effects.admissions).map(({ sourceContentGeneration }) => sourceContentGeneration),
				).toEqual([1, 2, 2]);
			}),
	);

	test.effect("admits a manual retry as fresh work and links its predecessor", () =>
		Effect.gen(function* () {
			const accepted = yield* (yield* TranslationsService).requestFill({
				...payload,
				retryOf: "failed-request",
			});
			expect(accepted).toBe(true);
			const admission = (yield* (yield* TranslationEffects).admissions).find(
				({ retryOf }) => retryOf === "failed-request",
			);
			expect(admission).toMatchObject({ dispatchRoot: true, retryOf: "failed-request" });
			expect(admission?.id).not.toBe(translateEntityExecutionId(payload));
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"captures queued recovery and repeated capture attempts from the admitted historical pin",
		() =>
			Effect.gen(function* () {
				const service = yield* TranslationsService;
				const effects = yield* TranslationEffects;
				yield* service.requestFill(payload);
				const [admission] = yield* effects.admissions;
				assert(admission);
				const queued = yield* Schema.decodeUnknownEffect(TranslateEntityWorkflowPayload)(
					admission.payload,
				);
				yield* effects.upgrade;
				expect(yield* service.requestFill(payload)).toBe(false);
				const recovered = yield* service.admitExecution(queued);
				const retried = yield* service.admitExecution(queued);
				expect(recovered).toEqual(execution);
				expect(retried).toEqual(recovered);
				expect(retried.principal.pluginRevision?.configRevisionId).toBe(
					execution.principal.pluginRevision.configRevisionId,
				);
				yield* service.upsert(overlay, queued, retried);
				expect(yield* effects.registrations).toEqual([queued.executionId]);
				expect(yield* effects.released).toEqual([]);
				yield* effects.changeContent;
				yield* service.requestFill(payload);
				expect((yield* effects.admissions).at(-1)?.payload).toMatchObject({
					principal: {
						scriptId: "upgraded-translation-script",
						pluginRevision: {
							revisionId: "upgraded-translation-revision",
							configRevisionId: "upgraded-translation-config",
						},
					},
				});
			}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("does not allocate another pin for a known queued request", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			const effects = yield* TranslationEffects;
			expect(yield* service.requestFill(payload)).toBe(true);
			expect(yield* service.requestFill(payload)).toBe(false);
			yield* effects.startRequest;
			expect(yield* service.requestFill(payload)).toBe(false);
			expect(yield* effects.registrations).toHaveLength(1);
			expect(yield* effects.admissions).toHaveLength(1);
			expect(yield* effects.executions).toHaveLength(1);
			expect(yield* effects.released).toEqual([]);
		}),
	);
});

layer(makeServiceLayer({ requestFailure: true }))((test) => {
	test.effect("does not register a pin when request admission fails", () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* Effect.exit((yield* TranslationsService).requestFill(payload)),
				new SandboxRunError({ kind: "infrastructure", message: "Admission failed" }),
			);
			const effects = yield* TranslationEffects;
			expect(yield* effects.released).toEqual(yield* effects.registrations);
			expect(yield* effects.registrations).toEqual([]);
			expect(yield* effects.executions).toEqual([]);
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("does not allocate another pin for a known terminal initial request", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			const effects = yield* TranslationEffects;
			expect(yield* service.requestFill(payload)).toBe(true);
			yield* effects.finishRequest;
			expect(yield* service.requestFill(payload)).toBe(false);
			expect(yield* effects.registrations).toHaveLength(1);
			expect(yield* effects.released).toEqual([]);
			expect(yield* effects.admissions).toHaveLength(1);
		}),
	);
});

for (const options of [{ requestState: "succeeded" as const }, { reusedRetry: true }]) {
	layer(makeServiceLayer(options))((test) => {
		test.effect("does not dispatch terminal or reused retry admissions", () =>
			Effect.gen(function* () {
				expect(
					yield* (yield* TranslationsService).requestFill({
						...payload,
						retryOf: "failed-request",
					}),
				).toBe(false);
				expect(yield* (yield* TranslationEffects).executions).toEqual([]);
				const effects = yield* TranslationEffects;
				expect(yield* effects.released).toEqual(yield* effects.registrations);
				expect(yield* effects.registrations).toEqual([]);
			}),
		);
	});
}

layer(makeServiceLayer({ storedProperties: {} }))((test) => {
	test.effect("fails closed when a selected canonical field is missing", () =>
		Effect.gen(function* () {
			expect(yield* (yield* TranslationsService).requestFill(payload)).toBe(true);
			assertExitFails(
				yield* Effect.exit((yield* TranslationsService).admitExecution(yield* pinnedPayload)),
				new SandboxRunError({
					kind: "invalid-input",
					message: "Translation input property 'title' is unavailable",
				}),
			);
			expect(yield* (yield* TranslationEffects).admissions).toHaveLength(1);
		}),
	);
});

layer(makeServiceLayer({ storedProperties: { title: "x".repeat(65_450) } }))((test) => {
	test.effect("bounds the full translation context before capturing execution", () =>
		Effect.gen(function* () {
			expect(yield* (yield* TranslationsService).requestFill(payload)).toBe(true);
			const failure = yield* (yield* TranslationsService)
				.admitExecution(yield* pinnedPayload)
				.pipe(Effect.flip);
			expect(failure.message).toContain("exceeds 65536 UTF-8 bytes");
		}),
	);
});

layer(makeServiceLayer({ selectedKeys: [], storedName: "x".repeat(65_536) }))((test) => {
	test.effect("tracks an oversized canonical name only after queue admission", () =>
		Effect.gen(function* () {
			expect(yield* (yield* TranslationsService).requestFill(payload)).toBe(true);
			const failure = yield* (yield* TranslationsService)
				.admitExecution(yield* pinnedPayload)
				.pipe(Effect.flip);
			expect(failure).toMatchObject({ kind: "invalid-input" });
			expect(failure.message).toContain("exceeds 65536 UTF-8 bytes");
			const [admitted] = yield* (yield* TranslationEffects).admissions;
			expect(admitted).toBeDefined();
			expect(admitted?.payload).not.toHaveProperty("name");
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("rejects stale content without writing a success or negative-cache overlay", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			const captured = yield* service.admitExecution(yield* pinnedPayload);
			yield* (yield* TranslationEffects).changeContent;
			for (const input of [overlay, { ...overlay, name: null, properties: null }]) {
				assertExitFails(
					yield* Effect.exit(service.upsert(input, payload, captured)),
					new SandboxRunError({
						kind: "invalid-input",
						message: "Translation source content changed before commit",
					}),
				);
			}
			expect(yield* (yield* TranslationEffects).upserts).toEqual([]);
		}),
	);
});

layer(makeServiceLayer({ assetOwnerUserId: "foreign-user" }))((test) => {
	test.effect("rejects a translation that references another user's managed asset", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			const captured = yield* service.admitExecution(yield* pinnedPayload);
			assertExitFails(
				yield* Effect.exit(service.upsert(assetOverlay, payload, captured)),
				new SandboxRunError({
					kind: "invalid-input",
					data: { code: "asset-forbidden" },
					message: "Translation references a forbidden managed asset",
				}),
			);
			expect(yield* (yield* TranslationEffects).upserts).toEqual([]);
		}),
	);
});

layer(makeServiceLayer({ globalEntity: true, systemPlugin: true }))((test) => {
	test.effect("rejects a global-entity translation that references a user's own asset", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			const globalPayload = yield* pinnedPayload;
			const captured = yield* service.admitExecution(globalPayload);
			assertExitFails(
				yield* Effect.exit(service.upsert(assetOverlay, globalPayload, captured)),
				new SandboxRunError({
					kind: "invalid-input",
					data: { code: "asset-forbidden" },
					message: "Translation references a forbidden managed asset",
				}),
			);
			expect(yield* (yield* TranslationEffects).upserts).toEqual([]);
		}),
	);
});
