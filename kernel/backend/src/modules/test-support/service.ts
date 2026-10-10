import { createLocalAccountIssuer, createOAuthAccountIssuer } from "@better-auth/core/db";
import type { ContractPayload } from "@ryot-app/contract/client";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import type { EntitySchemaReference } from "@ryot-app/contract/modules/plugins/references";
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
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { AuthService } from "#modules/accounts/auth/service";
import {
	childLifecycleCommand,
	rootLifecycleCommand,
} from "#modules/automations/lifecycle/command";
import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entities/watches/service";
import { PluginInstallationService } from "#modules/plugins/installations/service";
import { PluginIngestionService } from "#modules/plugins/packages/ingestion-service";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { PluginCronService } from "#modules/scheduler/plugin-cron";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { redisKeys, RedisService } from "#platform/redis";

type CreateGlobalEntityInput = {
	readonly name: string;
	readonly externalId?: string | undefined;
	readonly entitySchema: EntitySchemaReference;
	readonly properties: Record<string, unknown>;
	readonly populatedAt?: string | null | undefined;
	readonly providerId?: SandboxProviderId | undefined;
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
			accountGeneration: null,
			initiator: { id: null, kind: "system" },
			occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
		}),
		writeContext: null,
	};
});

const childSystemApiCommand = (
	command: ReturnType<typeof rootLifecycleCommand>,
	itemIdentity: string,
) => ({ ...childLifecycleCommand(command, itemIdentity), writeContext: null });

const reportWarnings = (
	operation: string,
	warnings: ReadonlyArray<AutomationWarning>,
): Effect.Effect<void> =>
	warnings.length === 0
		? Effect.void
		: Effect.logWarning("test support lifecycle warnings", { warnings, operation });

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
	"TestSupportService",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;
			const redis = yield* RedisService;
			const entities = yield* EntitiesService;
			const interest = yield* InterestService;
			const pluginCrons = yield* PluginCronService;
			const sandbox = yield* ScriptExecutionService;
			const translations = yield* TranslationsRepository;
			const relationships = yield* RelationshipsService;
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
					contentHash: input.contentHash,
					compiledScripts: input.compiledScripts,
					...(compiledClient === undefined ? {} : { compiledClient }),
				});
				return yield* getPluginOperationResult({ pluginId: updated.pluginId });
			});
			const createGlobalEntity = Effect.fn("TestSupportService.createGlobalEntity")(function* (
				input: CreateGlobalEntityInput,
			) {
				const command = yield* systemApiCommand("test-support:create-global-entity");
				const created = yield* entities.createGlobal({
					name: input.name,
					populatedAt: null,
					properties: input.properties,
					externalId: input.externalId,
					providerId: input.providerId,
					entitySchema: input.entitySchema,
					lifecycle: childSystemApiCommand(command, "create"),
				});
				if (input.populatedAt === undefined) {
					yield* reportWarnings("create-global-entity", created.warnings);
					return created.entity;
				}
				const updated = yield* entities.update({
					scope: "global",
					name: created.entity.name,
					entityId: created.entity.id,
					properties: created.entity.properties,
					lifecycle: childSystemApiCommand(command, "set-populated-at"),
					populatedAt: input.populatedAt === null ? null : yield* parseDate(input.populatedAt),
				});
				yield* reportWarnings("create-global-entity", [...created.warnings, ...updated.warnings]);
				return updated.entity;
			});

			const setEntityPopulatedAt = Effect.fn("TestSupportService.setEntityPopulatedAt")(function* (
				entityId: EntityId,
				populatedAt: string | null,
			) {
				const entity = yield* entities.getByIdAnyScope(entityId);
				const updated = yield* entities.update({
					entityId,
					scope: "global",
					name: entity.name,
					properties: entity.properties,
					populatedAt: populatedAt === null ? null : yield* parseDate(populatedAt),
					lifecycle: yield* systemApiCommand(
						stableStringify(["test-support:set-entity-populated-at", entityId]),
					),
				});
				yield* reportWarnings("set-entity-populated-at", updated.warnings);
				return updated.entity;
			});

			const upsertGlobalRelationship = Effect.fn("TestSupportService.upsertGlobalRelationship")(
				function* (input: ContractPayload<"testSupport", "upsertGlobalRelationship">) {
					const schema = yield* relationshipSchemas.findByReference(input.relationshipSchema, null);
					if (!schema) {
						return yield* new TestSupportBadRequest({
							reason: { code: "invalid-request", diagnostic: "Relationship schema not found" },
						});
					}
					const result = yield* relationships.create(
						{
							scope: "global",
							properties: input.properties ?? {},
							sourceEntityId: input.sourceEntityId,
							targetEntityId: input.targetEntityId,
							relationshipSchema: input.relationshipSchema,
						},
						yield* systemApiCommand(
							stableStringify([
								"test-support:upsert-global-relationship",
								input.relationshipSchema,
								input.sourceEntityId,
								input.targetEntityId,
							]),
						),
					);
					yield* reportWarnings("upsert-global-relationship", result.warnings);
					return (
						result.relationship ??
						(yield* new TestSupportBadRequest({
							reason: {
								code: "invalid-request",
								diagnostic: "Relationship mutation returned no relationship",
							},
						}))
					);
				},
			);

			const deleteGlobalEntities = Effect.fn("TestSupportService.deleteGlobalEntities")(function* (
				ids: readonly [EntityId, ...EntityId[]],
			) {
				const result = yield* entities.deleteByIds(
					ids,
					yield* systemApiCommand("test-support:delete-global-entities"),
				);
				yield* reportWarnings("delete-global-entities", result.warnings);
				return result.deletedCount;
			});

			const linkAuthAccount = Effect.fn("TestSupportService.linkAuthAccount")(function* (input: {
				userId: UserId;
				accountId: string;
				providerId: string;
			}) {
				const id = generateId();
				const issuer =
					input.providerId === "credential"
						? createLocalAccountIssuer(input.providerId)
						: createOAuthAccountIssuer(input.providerId);
				yield* auth.linkAuthAccount({ id, issuer, ...input });
				return { id };
			});

			const upsertEntityTranslation = Effect.fn("TestSupportService.upsertEntityTranslation")(
				function* (input: {
					language: string;
					entityId: EntityId;
					name: string | null;
					properties: Record<string, unknown> | null;
				}) {
					return yield* translations
						.upsertOverlay({ ...input, populatedAt: yield* DateTime.nowAsDate })
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
				setEntityWatchMembership: interest.setEntityWatchMembership,
				uninstallSystemPlugin: (pluginId: PluginId, activationId: string) =>
					pluginIngestion.uninstallPlugin(pluginId, activationId),
				enqueueSandbox: (input: TestSupportEnqueueSandboxBody) => {
					const { lane, executingUserId, ...payload } = input;
					return sandbox.enqueue(executingUserId, payload, lane);
				},
				deleteSandboxReplayProjection: (executionId: string) =>
					redis
						.del(redisKeys.sandboxWorkflowJournal(executionId))
						.pipe(Effect.map((deleted) => ({ deleted: deleted > 0 }))),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
