import { createLocalAccountIssuer, createOAuthAccountIssuer } from "@better-auth/core/db";
import { PgClient } from "@effect/sql-pg";
import { PluginClientArtifactFromBase64 } from "@ryot-app/client-plugin-contract";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import type {
	InstallPluginBody,
	UpdatePrivatePluginBody,
} from "@ryot-app/contract/modules/plugins/schemas";
import type {
	TestSupportInstallSystemPluginBodyBase64,
	TestSupportEnqueueSandboxBody,
	TestSupportTriggerPluginCronBody,
} from "@ryot-app/contract/modules/test-support/schemas";
import {
	TestSupportBadRequest,
	TestSupportOperationFailure,
} from "@ryot-app/contract/modules/test-support/schemas";
import {
	AutomationExecutionId,
	type EntitySchemaSlug,
	type EntityId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	type PluginSlug,
	type RelationshipSchemaSlug,
	type SandboxProviderId,
	SandboxScriptId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { type LifecycleCommand, rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { AuthService } from "#modules/auth/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entity-interest/service";
import { TranslationsService } from "#modules/entity-translation/service";
import { PluginInstallationService } from "#modules/plugins/installation-service";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginIngestionService } from "#modules/plugins/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { PluginCronService } from "#modules/scheduler/plugin-cron";

type CreateGlobalEntityInput = {
	readonly name: string;
	readonly externalId?: string | undefined;
	readonly entitySchemaSlug: EntitySchemaSlug;
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

const childCommand = (command: LifecycleCommand, itemIdentity: string): LifecycleCommand => ({
	...command,
	itemIdentity: stableStringify([command.itemIdentity, itemIdentity]),
});

const systemApiCommand = Effect.fnUntraced(function* (itemIdentity: string) {
	const executionId = AutomationExecutionId.make(generateId());
	return rootLifecycleCommand({
		executionId,
		itemIdentity,
		source: "api",
		initiator: { id: null, kind: "system" },
		occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
	});
});

const reportWarnings = (
	operation: string,
	warnings: ReadonlyArray<AutomationWarning>,
): Effect.Effect<void> =>
	warnings.length === 0
		? Effect.void
		: Effect.logWarning("test support lifecycle warnings", { warnings, operation });

export class TestSupportService extends Context.Service<TestSupportService>()(
	"TestSupportService",
	{
		make: Effect.gen(function* () {
			const database = yield* Database;
			const sqlClient = yield* PgClient.PgClient;
			const planner = yield* LifecyclePlanner;
			const lifecycleExecution = yield* LifecycleExecution;
			const entitiesRepository = yield* EntitiesRepository;
			const auth = yield* AuthService;
			const redis = yield* RedisService;
			const entities = yield* EntitiesService;
			const interest = yield* InterestService;
			const pluginCrons = yield* PluginCronService;
			const sandbox = yield* SandboxExecutionService;
			const translations = yield* TranslationsService;
			const relationships = yield* RelationshipsService;
			const pluginIngestion = yield* PluginIngestionService;
			const pluginInstallations = yield* PluginInstallationService;
			const pluginRepository = yield* PluginRepository;
			const relationshipSchemas = yield* RelationshipSchemasRepository;
			const provideMutation = <A, E>(
				effect: Effect.Effect<
					A,
					E,
					Database | EntitiesRepository | LifecycleExecution | LifecyclePlanner | PgClient.PgClient
				>,
			) =>
				effect.pipe(
					Effect.provideService(Database, database),
					Effect.provideService(PgClient.PgClient, sqlClient),
					Effect.provideService(LifecyclePlanner, planner),
					Effect.provideService(LifecycleExecution, lifecycleExecution),
					Effect.provideService(EntitiesRepository, entitiesRepository),
				);
			const getPluginOperationResult = Effect.fn("TestSupportService.getPluginOperationResult")(
				function* (
					identity: Parameters<PluginRepository["Service"]["findTestSupportOperationResult"]>[0],
				) {
					const result = yield* pluginRepository.findTestSupportOperationResult(identity);
					if (!result) {
						return yield* new TestSupportOperationFailure({
							reason: {
								code: "operation-failed",
								diagnostic: `Plugin '${"pluginId" in identity ? identity.pluginId : identity.slug}' was not persisted after ingestion`,
							},
						});
					}
					return {
						pluginId: PluginId.make(result.id),
						installationId: result.installationId,
						activePluginRevisionId: PluginRevisionId.make(result.activeRevisionId),
						scripts: result.scripts.map(({ id, slug }) => ({ slug, id: SandboxScriptId.make(id) })),
						configRevisionId:
							result.configRevisionId === null
								? null
								: PluginConfigRevisionId.make(result.configRevisionId),
					};
				},
			);
			const installSystemPlugin = Effect.fn("TestSupportService.installSystemPlugin")(function* (
				input: TestSupportInstallSystemPluginBodyBase64,
			) {
				const files = Object.fromEntries(
					yield* Effect.forEach(Object.entries(input.files), ([path, contents]) =>
						Schema.decodeEffect(Schema.Uint8ArrayFromBase64)(contents).pipe(
							Effect.map((decoded) => [path, decoded] as const),
							Effect.mapError(
								() =>
									new TestSupportBadRequest({
										reason: {
											code: "invalid-request",
											diagnostic: `Plugin file '${path}' must be canonical padded Base64`,
										},
									}),
							),
						),
					),
				);
				const compiledClient =
					input.compiledClient === undefined
						? undefined
						: yield* Schema.decodeUnknownEffect(PluginClientArtifactFromBase64)(
								input.compiledClient,
							).pipe(
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
				const installed = yield* pluginIngestion.installPlugin({
					files,
					manifest: input.manifest,
					compiledScripts: input.compiledScripts,
					...(compiledClient === undefined ? {} : { compiledClient }),
				});
				return yield* getPluginOperationResult({
					ownerId: null,
					scope: "system",
					slug: installed.slug,
				});
			});
			const installPrivatePlugin = Effect.fn("TestSupportService.installPrivatePlugin")(function* (
				userId: UserId,
				input: InstallPluginBody,
			) {
				const installed = yield* pluginInstallations.installPrivatePlugin({ userId, ...input });
				return yield* getPluginOperationResult({
					scope: "user",
					ownerId: userId,
					pluginId: installed.pluginId,
				});
			});
			const updatePrivatePlugin = Effect.fn("TestSupportService.updatePrivatePlugin")(function* (
				userId: UserId,
				pluginSlug: PluginSlug,
				input: UpdatePrivatePluginBody,
			) {
				yield* pluginInstallations.updatePrivatePlugin({ userId, pluginSlug, ...input });
				return yield* getPluginOperationResult({
					scope: "user",
					ownerId: userId,
					slug: pluginSlug,
				});
			});

			const createGlobalEntity = Effect.fn("TestSupportService.createGlobalEntity")(function* (
				input: CreateGlobalEntityInput,
			) {
				const command = yield* systemApiCommand("test-support:create-global-entity");
				const created = yield* provideMutation(
					entities.createGlobal({
						name: input.name,
						populatedAt: null,
						properties: input.properties,
						externalId: input.externalId,
						providerId: input.providerId,
						entitySchemaSlug: input.entitySchemaSlug,
						lifecycle: childCommand(command, "create"),
					}),
				);
				if (input.populatedAt === undefined) {
					yield* reportWarnings("create-global-entity", created.warnings);
					return created.entity;
				}
				const updated = yield* provideMutation(
					entities.update({
						scope: "global",
						name: created.entity.name,
						entityId: created.entity.id,
						properties: created.entity.properties,
						lifecycle: childCommand(command, "set-populated-at"),
						populatedAt: input.populatedAt === null ? null : yield* parseDate(input.populatedAt),
					}),
				);
				yield* reportWarnings("create-global-entity", [...created.warnings, ...updated.warnings]);
				return updated.entity;
			});

			const setEntityPopulatedAt = Effect.fn("TestSupportService.setEntityPopulatedAt")(function* (
				entityId: EntityId,
				populatedAt: string | null,
			) {
				const entity = yield* entities.getByIdAnyScope(entityId);
				const updated = yield* provideMutation(
					entities.update({
						entityId,
						scope: "global",
						name: entity.name,
						properties: entity.properties,
						populatedAt: populatedAt === null ? null : yield* parseDate(populatedAt),
						lifecycle: yield* systemApiCommand(
							stableStringify(["test-support:set-entity-populated-at", entityId]),
						),
					}),
				);
				yield* reportWarnings("set-entity-populated-at", updated.warnings);
				return updated.entity;
			});

			const upsertGlobalRelationship = Effect.fn("TestSupportService.upsertGlobalRelationship")(
				function* (input: {
					sourceEntityId: EntityId;
					targetEntityId: EntityId;
					relationshipSchemaSlug: RelationshipSchemaSlug;
					properties?: Record<string, unknown> | undefined;
				}) {
					const relationshipSchema = yield* relationshipSchemas.findById(
						input.relationshipSchemaSlug,
						null,
					);
					if (!relationshipSchema) {
						return yield* new TestSupportBadRequest({
							reason: { code: "invalid-request", diagnostic: "Relationship schema not found" },
						});
					}
					const result = yield* provideMutation(
						relationships.create(
							{
								scope: "global",
								properties: input.properties ?? {},
								sourceEntityId: input.sourceEntityId,
								targetEntityId: input.targetEntityId,
								relationshipSchemaSlug: input.relationshipSchemaSlug,
								relationshipSchemaPluginId: relationshipSchema.pluginId ?? null,
							},
							yield* systemApiCommand(
								stableStringify([
									"test-support:upsert-global-relationship",
									input.relationshipSchemaSlug,
									input.sourceEntityId,
									input.targetEntityId,
								]),
							),
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
				const result = yield* provideMutation(
					entities.deleteByIds(ids, yield* systemApiCommand("test-support:delete-global-entities")),
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
					const id = yield* translations.upsert({
						...input,
						populatedAt: yield* DateTime.nowAsDate,
					});
					return { id };
				},
			);

			const triggerPluginCron = (input: TestSupportTriggerPluginCronBody) =>
				pluginCrons.trigger(input.pluginSlug, input.cronSlug, `plugin-cron-manual-${generateId()}`);

			const reconcilePluginInstallations = Effect.gen(function* () {
				yield* pluginInstallations.reconcileSystemInstallations();
				yield* pluginInstallations.dispatchPendingInstallationLifecycle();
			});
			return {
				linkAuthAccount,
				triggerPluginCron,
				createGlobalEntity,
				installSystemPlugin,
				updatePrivatePlugin,
				installPrivatePlugin,
				setEntityPopulatedAt,
				deleteGlobalEntities,
				upsertEntityTranslation,
				upsertGlobalRelationship,
				reconcilePluginInstallations,
				getSandboxResult: sandbox.getResult,
				setEntityInterestMembership: interest.setEntityInterestMembership,
				uninstallSystemPlugin: (pluginSlug: PluginSlug) =>
					pluginIngestion.uninstallPlugin(pluginSlug),
				enqueueSandbox: (input: TestSupportEnqueueSandboxBody) => {
					const { executingUserId, ...payload } = input;
					return sandbox.enqueue(executingUserId, payload);
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
