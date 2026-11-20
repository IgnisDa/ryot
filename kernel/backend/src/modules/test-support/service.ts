import type { ContractPayload } from "@ryot-app/contract/client";
import { EntityNotFound } from "@ryot-app/contract/modules/entities/schemas";
import {
	definitionOwner,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	TestSupportBadRequest,
	type TestSupportEnqueueSandboxBody,
	type TestSupportInstallSystemPluginBodyBase64,
	TestSupportOperationFailure,
	type TestSupportTriggerPluginCronBody,
	type TestSupportUpdateSystemPluginBodyBase64,
} from "@ryot-app/contract/modules/test-support/schemas";
import {
	AutomationExecutionId,
	type EntityId,
	PluginId,
	PluginRevisionId,
	type SandboxProviderId,
	SandboxScriptId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { PluginClientArtifactFromBase64 } from "@ryot-app/plugin-client-contract";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { AuthService } from "#modules/accounts/auth/service";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { savedEntity } from "#modules/changes/receipts";
import { ChangeSets } from "#modules/changes/service";
import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginInstallationService } from "#modules/plugins/installations/service";
import { PluginIngestionService } from "#modules/plugins/packages/ingestion-service";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { PluginCronService } from "#modules/scheduler/plugin-cron";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { DatabaseSession } from "#platform/db/session";
import { sandboxJournalEntry } from "#schema/tables/sandbox-journal";

import { AutomationInspectionRepository } from "./automation-inspection-repository";

type CreateGlobalEntityInput = {
	readonly name: string;
	readonly externalId?: string | undefined;
	readonly entitySchema: EntitySchemaReference;
	readonly properties: Record<string, unknown>;
	readonly level?: "base" | "full" | undefined;
	readonly populatedAt?: null | string | undefined;
	readonly providerId?: undefined | SandboxProviderId;
};

const parseDate = (value: string) => {
	const parsed = new Date(value);
	return !Number.isNaN(parsed.getTime())
		? Effect.succeed(parsed)
		: Effect.fail(
				new TestSupportBadRequest({
					reason: {
						code: "invalid-request",
						diagnostic: "populatedAt must be a valid ISO 8601 date",
					},
				}),
			);
};

const systemApiCommand = Effect.fnUntraced(function* (itemIdentity: string) {
	const executionId = AutomationExecutionId.make(generateId());
	return {
		...rootLifecycleCommand({
			executionId,
			itemIdentity,
			source: "api",
			lane: "interactive",
			accountUserId: null,
			initiator: { id: null, kind: "system" },
			occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
		}),
		writeContext: null,
	};
});

const decodeCompiledClient = (
	compiledClient: TestSupportInstallSystemPluginBodyBase64["compiledClient"],
) =>
	compiledClient === undefined
		? Effect.void
		: Schema.decodeUnknownEffect(PluginClientArtifactFromBase64)(compiledClient).pipe(
				Effect.mapError(
					() =>
						new TestSupportBadRequest({
							reason: {
								code: "invalid-request",
								diagnostic: "Plugin client artifact must be a valid Base64 artifact",
							},
						}),
				),
			);

export class TestSupportService extends Context.Service<TestSupportService>()(
	"@ryot-app/kernel-backend/modules/test-support/service/TestSupportService",
	{
		make: Effect.gen(function* () {
			const automationInspection = yield* AutomationInspectionRepository;
			const auth = yield* AuthService;
			const session = yield* DatabaseSession;
			const entityRepository = yield* EntitiesRepository;
			const pluginCrons = yield* PluginCronService;
			const sandbox = yield* ScriptExecutionService;
			const translations = yield* TranslationsRepository;
			const changeSets = yield* ChangeSets;
			const relationships = yield* RelationshipsRepository;
			const pluginIngestion = yield* PluginIngestionService;
			const pluginInstallations = yield* PluginInstallationService;
			const pluginRepository = yield* PluginRepository;
			const relationshipSchemas = yield* RelationshipSchemaReader;
			const getPluginOperationResult = Effect.fn("TestSupportService.getPluginOperationResult")(
				function* (
					identity: Parameters<PluginRepository["Service"]["findTestSupportOperationResult"]>[0],
				) {
					const result = yield* pluginRepository.findTestSupportOperationResult(identity);
					if (!result) {
						return yield* new TestSupportOperationFailure({
							reason: {
								code: "operation-failed",
								diagnostic: `Plugin '${identity.pluginId}' was not persisted after ingestion`,
							},
						});
					}
					return {
						activationId: result.activationId,
						pluginId: PluginId.make(result.id),
						installationId: result.installationId,
						configRevisionId: result.configRevisionId,
						activePluginRevisionId: PluginRevisionId.make(result.activeRevisionId),
						scripts: result.scripts.map(({ id, slug }) => ({ slug, id: SandboxScriptId.make(id) })),
					};
				},
			);
			const installSystemPlugin = Effect.fn("TestSupportService.installSystemPlugin")(function* (
				input: TestSupportInstallSystemPluginBodyBase64,
			) {
				const compiledClient = yield* decodeCompiledClient(input.compiledClient);
				const installed = yield* pluginIngestion.installPlugin({
					manifest: input.manifest,
					catalogs: input.catalogs,
					compiledScripts: input.compiledScripts,
					...(compiledClient === undefined ? {} : { compiledClient }),
				});
				return yield* getPluginOperationResult({ pluginId: installed.pluginId });
			});
			const updateSystemPlugin = Effect.fn("TestSupportService.updateSystemPlugin")(function* (
				pluginId: PluginId,
				input: TestSupportUpdateSystemPluginBodyBase64,
			) {
				const compiledClient = yield* decodeCompiledClient(input.compiledClient);
				const updated = yield* pluginIngestion.updatePlugin({
					pluginId,
					manifest: input.manifest,
					catalogs: input.catalogs,
					contentHash: input.contentHash,
					compiledScripts: input.compiledScripts,
					...(compiledClient === undefined ? {} : { compiledClient }),
				});
				return yield* getPluginOperationResult({ pluginId: updated.pluginId });
			});
			const stampSeededRelatedLevel = (
				entityId: EntityId,
				populatedAt: Date | null,
				level: "base" | "full",
			) =>
				populatedAt === null || level === "base"
					? Effect.void
					: session
							.transaction(entityRepository.stampRelatedPopulated(entityId, populatedAt))
							.pipe(Effect.orDie);

			const createGlobalEntity = Effect.fn("TestSupportService.createGlobalEntity")(function* (
				input: CreateGlobalEntityInput,
			) {
				const command = yield* systemApiCommand("test-support:create-global-entity");
				const populatedAt =
					input.populatedAt === undefined || input.populatedAt === null
						? null
						: yield* parseDate(input.populatedAt);
				const created = yield* changeSets
					.commit(
						{
							userId: null,
							entities: {
								creates: [
									{
										name: input.name,
										properties: input.properties,
										entitySchema: input.entitySchema,
										populatedAt: populatedAt?.toISOString() ?? null,
										...(input.externalId === undefined ? {} : { externalId: input.externalId }),
										...(input.providerId === undefined
											? {}
											: { provider: { updateExisting: false, providerId: input.providerId } }),
									},
								],
							},
						},
						command,
					)
					.pipe(Effect.flatMap(savedEntity));
				if (input.populatedAt !== undefined) {
					yield* stampSeededRelatedLevel(created.id, populatedAt, input.level ?? "full");
				}
				return created;
			});

			const setEntityPopulatedAt = Effect.fn("TestSupportService.setEntityPopulatedAt")(function* (
				entityId: EntityId,
				populatedAt: null | string,
				level: "base" | "full",
			) {
				const entity = yield* entityRepository.getById(entityId);
				if (!entity) {
					return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
				}
				const populatedAtDate = populatedAt === null ? null : yield* parseDate(populatedAt);
				const updated = yield* changeSets
					.commit(
						{
							userId: null,
							entities: {
								updates: [
									{
										name: entity.name,
										properties: entity.properties,
										populatedAt: populatedAtDate?.toISOString() ?? null,
										entitySchema: {
											slug: entity.entitySchemaSlug,
											owner: definitionOwner(entity.entitySchemaPluginId),
										},
										target: {
											entityId,
											kind: "update",
											expected: {
												name: entity.name,
												updatedAt: entity.updatedAt,
												properties: entity.properties,
											},
										},
									},
								],
							},
						},
						yield* systemApiCommand(
							stableStringify(["test-support:set-entity-populated-at", entityId]),
						),
					)
					.pipe(Effect.flatMap(savedEntity));
				yield* stampSeededRelatedLevel(entityId, populatedAtDate, level);
				return updated;
			});

			const upsertGlobalRelationship = Effect.fn("TestSupportService.upsertGlobalRelationship")(
				function* (input: ContractPayload<"testSupport", "upsertGlobalRelationship">) {
					const schema = yield* relationshipSchemas.findByReference(input.relationshipSchema, null);
					if (!schema) {
						return yield* new TestSupportBadRequest({
							reason: { code: "invalid-request", diagnostic: "Relationship schema not found" },
						});
					}
					const identity = {
						scope: "global" as const,
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						relationshipSchemaPluginId: schema.pluginId,
						relationshipSchemaSlug: input.relationshipSchema.slug,
					};
					const existing = yield* relationships.findRelationship(identity);
					const source = { kind: "existing" as const, entityId: input.sourceEntityId };
					yield* changeSets
						.commit(
							{
								userId: null,
								globalRelationships: [
									{
										relationshipSchema: input.relationshipSchema,
										paging: { kind: "page", preserveExisting: false },
										selector: { anchor: source, type: "anchored", direction: "outgoing" },
										relationships: [
											{
												source,
												properties: input.properties ?? {},
												target: { kind: "existing", entityId: input.targetEntityId },
											},
										],
									},
								],
							},
							yield* systemApiCommand(
								stableStringify([
									"test-support:upsert-global-relationship",
									input.relationshipSchema,
									input.sourceEntityId,
									input.targetEntityId,
								]),
							),
						)
						.pipe(
							Effect.mapError((error) =>
								error._tag === "DbError"
									? error
									: new TestSupportBadRequest({
											reason: { diagnostic: error._tag, code: "invalid-request" },
										}),
							),
						);
					const relationship = yield* relationships.findRelationship(identity);
					return relationship
						? { ...relationship, wasInserted: existing === null }
						: yield* new TestSupportBadRequest({
								reason: {
									code: "invalid-request",
									diagnostic: "Relationship mutation returned no relationship",
								},
							});
				},
			);

			const deleteGlobalEntities = Effect.fn("TestSupportService.deleteGlobalEntities")(function* (
				ids: readonly [EntityId, ...EntityId[]],
			) {
				const found = yield* Effect.forEach(ids, (entityId) => entityRepository.getById(entityId));
				const deletes = found.flatMap((entity) =>
					entity === null
						? []
						: [
								{
									entityId: entity.id,
									entitySchema: {
										slug: entity.entitySchemaSlug,
										owner: definitionOwner(entity.entitySchemaPluginId),
									},
								},
							],
				);
				if (deletes.length === 0) {
					return 0;
				}
				const committed = yield* changeSets.commit(
					{ userId: null, entities: { deletes } },
					yield* systemApiCommand("test-support:delete-global-entities"),
				);
				return committed.deleted.length;
			});

			const linkAuthAccount = Effect.fn("TestSupportService.linkAuthAccount")(function* (input: {
				userId: UserId;
				accountId: string;
				providerId: string;
			}) {
				const id = generateId();
				yield* auth.linkAuthAccount({ id, ...input });
				return { id };
			});

			const upsertEntityTranslation = Effect.fn("TestSupportService.upsertEntityTranslation")(
				function* (input: {
					language: string;
					entityId: EntityId;
					name: null | string;
					properties: null | Record<string, unknown>;
				}) {
					const entity = yield* translations.findEntityById(input.entityId);
					if (!entity) {
						return yield* new TestSupportOperationFailure({
							reason: { code: "operation-failed", diagnostic: "Translation entity is unavailable" },
						});
					}
					return yield* translations
						.upsertOverlay({
							...input,
							populatedAt: yield* DateTime.nowAsDate,
							sourceContentGeneration: entity.contentGeneration,
						})
						.pipe(
							Effect.mapError(
								(error) =>
									new TestSupportOperationFailure({
										reason: { code: "operation-failed", diagnostic: error.message },
									}),
							),
						);
				},
			);

			const triggerPluginCron = (input: TestSupportTriggerPluginCronBody) =>
				pluginCrons.trigger(input.pluginId, input.cronSlug, `plugin-cron-manual-${generateId()}`);

			const reconcilePluginInstallations = Effect.gen(function* () {
				yield* pluginInstallations.reconcileSystemInstallations();
				yield* pluginInstallations.dispatchPendingInstallationLifecycle();
			});
			return {
				linkAuthAccount,
				triggerPluginCron,
				createGlobalEntity,
				updateSystemPlugin,
				installSystemPlugin,
				setEntityPopulatedAt,
				deleteGlobalEntities,
				upsertEntityTranslation,
				upsertGlobalRelationship,
				reconcilePluginInstallations,
				getSandboxResult: sandbox.getResult,
				listAutomationRuns: automationInspection.listRuns,
				listAutomationTriggers: automationInspection.listTriggers,
				listAutomationAttempts: automationInspection.listAttempts,
				listAutomationRecipients: automationInspection.listRecipients,
				uninstallSystemPlugin: (pluginId: PluginId, activationId: string) =>
					pluginIngestion.uninstallPlugin(pluginId, activationId),
				enqueueSandbox: (input: TestSupportEnqueueSandboxBody) => {
					const { lane, executingUserId, ...payload } = input;
					return sandbox.enqueue(executingUserId, payload, lane);
				},
				deleteSandboxReplayProjection: (executionId: string) =>
					session
						.run((db) =>
							db
								.delete(sandboxJournalEntry)
								.where(eq(sandboxJournalEntry.executionId, executionId))
								.returning({ entryIndex: sandboxJournalEntry.entryIndex }),
						)
						.pipe(Effect.map((deleted) => ({ deleted: deleted.length > 0 }))),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
