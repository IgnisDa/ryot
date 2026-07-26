import { createLocalAccountIssuer, createOAuthAccountIssuer } from "@better-auth/core/db";
import { PgClient } from "@effect/sql-pg";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import type {
	InstallPluginBody,
	UpdatePrivatePluginBody,
} from "@ryot-app/contract/modules/plugins/schemas";
import type {
	TestSupportEnqueueSandboxBody,
	TestSupportListAutomationRunAttemptsBody,
	TestSupportListAutomationRunsBody,
	TestSupportListAutomationTriggerRecipientsBody,
	TestSupportListAutomationTriggersBody,
	TestSupportStoredSandboxScript,
	TestSupportTriggerPluginCronBody,
} from "@ryot-app/contract/modules/test-support/schemas";
import {
	TestSupportBadRequest,
	TestSupportOperationFailure,
} from "@ryot-app/contract/modules/test-support/schemas";
import {
	AutomationExecutionId,
	AutomationTriggerId,
	EntitySchemaSlug,
	type EntityId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	PluginSlug,
	type RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { and, desc, eq, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { type LifecycleCommand, rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { automationTrigger as automationTriggerTable } from "#lib/infrastructure/db/schema/tables/automations";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { AuthService } from "#modules/auth/service";
import { AutomationHistoryRepository } from "#modules/automations/history-repository";
import { AutomationRunRepository } from "#modules/automations/run-repository";
import { AutomationsService } from "#modules/automations/service";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entity-interest/service";
import { TranslationsService } from "#modules/entity-translation/service";
import { PluginInstallationService } from "#modules/plugins/installation-service";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginIngestionService } from "#modules/plugins/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import type { GlobalRelationshipListInput } from "#modules/relationships/repository";
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

type StoredSandboxScriptRow = Omit<TestSupportStoredSandboxScript, "providerId"> & {
	readonly providerId: string | null;
};

const toStoredSandboxScript = (script: StoredSandboxScriptRow) => ({
	...script,
	providerId: script.providerId === null ? null : SandboxProviderId.make(script.providerId),
});

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

const TEST_SUPPORT_INSPECTION_LIMIT = 1_000;

const sourceRecordCondition = (
	sourceRecord: TestSupportListAutomationTriggersBody["sourceRecord"],
) => {
	if (sourceRecord === undefined) {
		return undefined;
	}
	const recordId =
		sourceRecord.resource === "provider-entity-import"
			? sql<string>`${automationTriggerTable.payload}->>'entityId'`
			: sql<string>`coalesce(${automationTriggerTable.payload}->'after'->>'id', ${automationTriggerTable.payload}->'before'->>'id')`;
	return and(
		eq(automationTriggerTable.resourceKind, sourceRecord.resource),
		eq(recordId, sourceRecord.id),
	);
};

export const makeTestSupportAutomationInspection = Effect.gen(function* () {
	const database = yield* Database;
	const triggers = yield* AutomationTriggerRepository;
	const runs = yield* AutomationRunRepository;
	const history = yield* AutomationHistoryRepository;
	const persisted = <A, E>(effect: Effect.Effect<A, E, Database>) =>
		effect.pipe(Effect.provideService(Database, database));
	const listAutomationTriggers = Effect.fn("TestSupportService.listAutomationTriggers")(function* (
		input: TestSupportListAutomationTriggersBody,
	) {
		const rows = yield* mapDatabaseErrors(
			database
				.select({ id: automationTriggerTable.id })
				.from(automationTriggerTable)
				.where(
					and(
						input.triggerId === undefined
							? undefined
							: eq(automationTriggerTable.id, input.triggerId),
						input.rootExecutionId === undefined
							? undefined
							: eq(automationTriggerTable.rootExecutionId, input.rootExecutionId),
						input.payload === undefined
							? undefined
							: eq(automationTriggerTable.payload, input.payload),
						sourceRecordCondition(input.sourceRecord),
					),
				)
				.orderBy(desc(automationTriggerTable.createdAt), desc(automationTriggerTable.id))
				.limit(TEST_SUPPORT_INSPECTION_LIMIT),
		);
		const found = yield* Effect.forEach(rows, ({ id }) =>
			persisted(triggers.findById(AutomationTriggerId.make(id))),
		);
		return found.filter((trigger) => trigger !== null);
	});
	const listAutomationTriggerRecipients = Effect.fn(
		"TestSupportService.listAutomationTriggerRecipients",
	)(function* (input: TestSupportListAutomationTriggerRecipientsBody) {
		const recipients = yield* persisted(triggers.listRecipients(input.triggerId));
		return input.userId === undefined
			? recipients
			: recipients.filter(({ userId }) => userId === input.userId);
	});
	const listAutomationRuns = Effect.fn("TestSupportService.listAutomationRuns")(function* (
		input: TestSupportListAutomationRunsBody,
	) {
		const matchingTriggers = yield* listAutomationTriggers(input);
		const found = yield* Effect.forEach(matchingTriggers, ({ id }) =>
			persisted(runs.listByTrigger(id)),
		);
		return found
			.flat()
			.filter(
				(run) =>
					(input.hookSlug === undefined || run.hookSlug === input.hookSlug) &&
					(input.status === undefined || run.status === input.status) &&
					(input.executionUserId === undefined || run.executionUserId === input.executionUserId),
			)
			.sort((left, right) =>
				left.queuedAt === right.queuedAt
					? right.id.localeCompare(left.id)
					: right.queuedAt.localeCompare(left.queuedAt),
			);
	});
	const listAutomationRunAttempts = Effect.fn("TestSupportService.listAutomationRunAttempts")(
		function* (input: TestSupportListAutomationRunAttemptsBody) {
			const attempts = yield* persisted(history.attempts(input.runId));
			return input.status === undefined
				? attempts
				: attempts.filter(({ status }) => status === input.status);
		},
	);
	return {
		listAutomationRuns,
		listAutomationTriggers,
		listAutomationRunAttempts,
		listAutomationTriggerRecipients,
	};
});

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
			const definitions = yield* DefinitionRegistry;
			const automations = yield* AutomationsService;
			const sandbox = yield* SandboxExecutionService;
			const translations = yield* TranslationsService;
			const relationships = yield* RelationshipsService;
			const pluginIngestion = yield* PluginIngestionService;
			const pluginInstallations = yield* PluginInstallationService;
			const pluginRepository = yield* PluginRepository;
			const relationshipSchemas = yield* RelationshipSchemasRepository;
			const automationInspection = yield* makeTestSupportAutomationInspection;
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
								diagnostic: `Plugin '${identity.slug}' was not persisted after ingestion`,
							},
						});
					}
					return {
						...result.manifest.metadata,
						scope: result.scope,
						sourceHash: result.sourceHash,
						slug: PluginSlug.make(result.slug),
						pluginId: PluginId.make(result.id),
						installationId: result.installationId,
						activePluginRevisionId: PluginRevisionId.make(result.activeRevisionId),
						scripts: result.scripts.map((script) => ({
							...script,
							id: SandboxScriptId.make(script.id),
						})),
						configRevisionId:
							result.configRevisionId === null
								? null
								: PluginConfigRevisionId.make(result.configRevisionId),
					};
				},
			);
			const installSystemPlugin = Effect.fn("TestSupportService.installSystemPlugin")(
				function* (input: {
					readonly manifest: unknown;
					readonly files: Readonly<Record<string, string>>;
				}) {
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
					const installed = yield* pluginIngestion.installPlugin({
						files,
						manifest: input.manifest,
					});
					return yield* getPluginOperationResult({
						ownerId: null,
						scope: "system",
						slug: installed.slug,
					});
				},
			);
			const installPrivatePlugin = Effect.fn("TestSupportService.installPrivatePlugin")(function* (
				userId: UserId,
				input: InstallPluginBody,
			) {
				const installed = yield* pluginInstallations.installPrivatePlugin({ userId, ...input });
				return yield* getPluginOperationResult({
					scope: "user",
					ownerId: userId,
					slug: installed.slug,
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

			const listGlobalRelationships = Effect.fn("TestSupportService.listGlobalRelationships")(
				function* (input: GlobalRelationshipListInput) {
					const relationshipSchema = yield* relationshipSchemas.findById(
						input.relationshipSchemaSlug,
						null,
					);
					if (!relationshipSchema) {
						return yield* new TestSupportBadRequest({
							reason: { code: "invalid-request", diagnostic: "Relationship schema not found" },
						});
					}
					return yield* relationships.listGlobal({
						...input,
						relationshipSchemaPluginId: relationshipSchema.pluginId ?? null,
					});
				},
			);

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
					yield* translations.upsert({ ...input, populatedAt: yield* DateTime.nowAsDate });
					return { entityId: input.entityId, language: input.language };
				},
			);

			const triggerPluginCron = (input: TestSupportTriggerPluginCronBody) =>
				pluginCrons.trigger(input.pluginSlug, input.cronSlug, `plugin-cron-manual-${generateId()}`);

			const reconcilePluginInstallations = Effect.gen(function* () {
				yield* pluginInstallations.reconcileSystemInstallations();
				yield* pluginInstallations.dispatchPendingInstallationLifecycle();
			});
			const listSystemPlugins = Effect.suspend(() =>
				pluginIngestion
					.listPlugins()
					.pipe(
						Effect.flatMap((plugins) =>
							Effect.forEach(plugins, ({ slug }) =>
								getPluginOperationResult({ slug, ownerId: null, scope: "system" }),
							),
						),
					),
			);

			const countAutomationRules = Effect.fn("TestSupportService.countAutomationRules")(function* (
				userId: UserId,
			) {
				const count = yield* automations.countByUser(userId);
				return { count };
			});

			const getSandboxScript = Effect.fn("TestSupportService.getSandboxScript")(function* (
				scriptId: SandboxScriptId,
			) {
				const script = yield* sandbox.getStoredScript(scriptId);
				return toStoredSandboxScript(script as StoredSandboxScriptRow);
			});

			const listSandboxScripts = Effect.fn("TestSupportService.listSandboxScripts")(function* () {
				const scripts = yield* sandbox.listStoredScripts;
				return scripts.map((script) => toStoredSandboxScript(script as StoredSandboxScriptRow));
			});

			return {
				linkAuthAccount,
				getSandboxScript,
				triggerPluginCron,
				listSandboxScripts,
				createGlobalEntity,
				installSystemPlugin,
				updatePrivatePlugin,
				installPrivatePlugin,
				countAutomationRules,
				setEntityPopulatedAt,
				upsertEntityTranslation,
				listGlobalRelationships,
				upsertGlobalRelationship,
				...automationInspection,
				listSystemPlugins,
				deleteGlobalEntities,
				reconcilePluginInstallations,
				getSandboxResult: sandbox.getResult,
				listEntityTranslations: translations.listByEntity,
				setEntityInterestMembership: interest.setEntityInterestMembership,
				enqueueSandbox: (input: TestSupportEnqueueSandboxBody) => {
					const { executingUserId, ...payload } = input;
					return sandbox.enqueue(executingUserId, payload);
				},
				deleteSandboxReplayProjection: (executionId: string) =>
					redis
						.del(redisKeys.sandboxWorkflowJournal(executionId))
						.pipe(Effect.map((deleted) => ({ deleted: deleted > 0 }))),
				uninstallSystemPlugin: (pluginSlug: PluginSlug) =>
					Effect.gen(function* () {
						const result = yield* getPluginOperationResult({
							ownerId: null,
							scope: "system",
							slug: pluginSlug,
						});
						yield* pluginIngestion.uninstallPlugin(pluginSlug);
						return result;
					}),
				getBuiltinEntitySchema: (slug: string) =>
					Effect.succeed(definitions.getEntitySchema(slug)).pipe(
						Effect.flatMap((definition) =>
							definition
								? Effect.succeed({
										slug: definition.slug,
										name: definition.name,
										id: EntitySchemaSlug.make(definition.slug),
									})
								: Effect.fail(
										new TestSupportBadRequest({
											reason: { code: "invalid-request", diagnostic: "Entity schema not found" },
										}),
									),
						),
					),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(
			Layer.mergeAll(
				AutomationHistoryRepository.layer,
				AutomationRunRepository.layer,
				AutomationTriggerRepository.layer,
			),
		),
	);
}
