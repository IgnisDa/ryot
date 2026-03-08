import { unknownToMessage } from "@ryot/contract/errors";
import { CreateEventItem, type CreateEventsResponse } from "@ryot/contract/modules/events/schemas";
import { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import {
	EntityId,
	EntitySchemaSlug,
	IntegrationId,
	RelationshipSchemaSlug,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { sha256Base64Url } from "@ryot/ts-utils/crypto";
import { stableStringify } from "@ryot/ts-utils/json";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, DbRunner, dbEffect, TransactionRunner } from "#lib/infrastructure/db/service";
import { getPluginConfig, getSystemConfig } from "#lib/infrastructure/sandbox-runtime/app-config";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import {
	type AdditionalSandboxHostImplementationMap,
	isJsonValue,
	requireSandboxCapabilityInput,
	sandboxRunIntegrationId,
	sandboxHostEffect,
	toSandboxJsonValue,
	type UserSandboxRunInput,
} from "#lib/infrastructure/sandbox-runtime/shared";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { IntegrationsRepository, type IntegrationRecord } from "#modules/integrations/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipsRepository } from "#modules/relationships/repository";
import {
	changeUserRelationships,
	reconcileGlobalRelationships,
} from "#modules/relationships/service";
import { RyotQLService } from "#modules/ryotql/service";

type SandboxHostFunctionContext =
	| DbRunner
	| RyotQLService
	| EventsService
	| EntitiesService
	| TransactionRunner
	| EntitiesRepository
	| DefinitionRegistry
	| PluginRuntimeResolver
	| IntegrationsRepository
	| RelationshipsRepository;

const CreateEventsPayload = Schema.Array(CreateEventItem);

const decodeRyotQLDocument = Schema.decodeUnknownEffect(Schema.toType(RyotQLDocument));
const decodeCreateEventsPayload = Schema.decodeUnknownEffect(CreateEventsPayload);

const hashPayload = (payload: unknown) => sha256Base64Url(stableStringify(payload));

const toSandboxRelationshipIdentity = <
	T extends {
		readonly sourceEntityId: string;
		readonly targetEntityId: string;
		readonly relationshipSchemaSlug?: string;
	},
>(
	relationship: T,
) => ({
	...relationship,
	sourceEntityId: EntityId.make(relationship.sourceEntityId),
	targetEntityId: EntityId.make(relationship.targetEntityId),
	...(relationship.relationshipSchemaSlug === undefined
		? {}
		: { relationshipSchemaSlug: RelationshipSchemaSlug.make(relationship.relationshipSchemaSlug) }),
});

const toSandboxIntegrationSettings = (settings: Readonly<Record<string, unknown>>) =>
	Object.fromEntries(
		Object.entries(settings).map(([key, value]) => [key, toSandboxJsonValue(value)]),
	);

const toSandboxIntegration = (integration: IntegrationRecord) => {
	const { pluginSlug: _pluginSlug, ...record } = integration;
	return { ...record, providerSpecifics: toSandboxIntegrationSettings(record.providerSpecifics) };
};

const requireNonEmptyString = (value: unknown, message: string): Effect.Effect<string, string> => {
	if (typeof value !== "string" || value.trim().length === 0) {
		return Effect.fail(message);
	}

	return Effect.succeed(value.trim());
};

const requireUniqueNonEmptyStrings = (values: ReadonlyArray<unknown>, message: string) =>
	Effect.forEach(values, (value) => requireNonEmptyString(value, message)).pipe(
		Effect.map((strings) => [...new Set(strings)]),
	);

const normalizeConfigKeys = (
	fnName: string,
	rawKeys: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, string> => {
	const keys = rawKeys.map((key) => key.trim());
	return keys.some((key) => !key)
		? Effect.fail(`${fnName} expects non-empty key strings`)
		: Effect.succeed(keys);
};

const encodeConfigValues = (label: string, values: Readonly<Record<string, unknown>>) =>
	Effect.forEach(Object.entries(values), ([key, value]) =>
		isJsonValue(value)
			? Effect.succeed([key, value] as const)
			: Effect.fail(`${label} config key "${key}" is not JSON-compatible`),
	).pipe(Effect.map(Object.fromEntries));

export const normalizePreferences = (value: unknown) => {
	const source = isObjectRecord(value) ? value : {};
	return {
		isNsfw: source["isNsfw"] === true,
		disableIntegrations: source["disableIntegrations"] === true,
	};
};

export const toSandboxCreateEventsResult = (result: CreateEventsResponse) =>
	result.failure
		? Effect.fail(result.failure.reason.message)
		: Effect.succeed({ count: result.count });

export const makeAdditionalSandboxApiFunctions: Effect.Effect<
	AdditionalSandboxHostImplementationMap,
	never,
	SandboxHostFunctionContext
> = Effect.gen(function* () {
	const runWithDb = yield* DbRunner;
	const events = yield* EventsService;
	const entities = yield* EntitiesService;
	const ryotqlService = yield* RyotQLService;
	const definitions = yield* DefinitionRegistry;
	const runInTransaction = yield* TransactionRunner;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const entitiesRepository = yield* EntitiesRepository;
	const integrationsRepository = yield* IntegrationsRepository;
	const relationshipsRepository = yield* RelationshipsRepository;

	const readUserPreferences = (userId: UserId) =>
		runWithDb(
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ preferences: schema.user.preferences })
						.from(schema.user)
						.where(eq(schema.user.id, userId))
						.limit(1),
				);
				if (!row) {
					return yield* Effect.fail("User not found");
				}

				return normalizePreferences(row.preferences);
			}),
		);

	const createEvents = (input: UserSandboxRunInput, payload: ReadonlyArray<CreateEventItem>) =>
		payload.length === 0
			? Effect.succeed({ count: 0 })
			: events
					.create({
						payload,
						source: "sandbox",
						userId: UserId.make(input.authority.userId),
						executionId: `${input.executionId}-create-events-${hashPayload(payload)}`,
					})
					.pipe(Effect.flatMap(toSandboxCreateEventsResult));

	return {
		changeUserRelationships: (rawInput, batches) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "changeUserRelationships");
					const changeCount = batches.reduce(
						(total, batch) => total + batch.creates.length + batch.deletes.length,
						0,
					);
					if (changeCount > SANDBOX_LIMITS.userRelationshipWrites.changesTotal) {
						return yield* Effect.fail(
							`changeUserRelationships exceeds ${SANDBOX_LIMITS.userRelationshipWrites.changesTotal} changes`,
						);
					}
					return yield* changeUserRelationships(
						UserId.make(input.authority.userId),
						batches.map((batch) => ({
							creates: batch.creates.map(toSandboxRelationshipIdentity),
							deletes: batch.deletes.map(toSandboxRelationshipIdentity),
						})),
					).pipe(
						Effect.provideService(DefinitionRegistry, definitions),
						Effect.provideService(EntitiesRepository, entitiesRepository),
						Effect.provideService(TransactionRunner, runInTransaction),
						Effect.provideService(RelationshipsRepository, relationshipsRepository),
					);
				}),
			),
		ensureUserEntities: (rawInput, items) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "ensureUserEntities");
					const caller = yield* runWithDb(
						pluginRuntime.resolveTrustedUserBootstrapCaller(SandboxScriptId.make(input.scriptId)),
					);
					if (!caller) {
						return yield* Effect.fail(
							"ensureUserEntities is available only to trusted user bootstrap scripts",
						);
					}
					const ownedSchemaSlugs = new Set(caller.entitySchemaSlugs);
					for (const item of items) {
						const definition = definitions.getEntitySchema(item.entitySchemaSlug);
						if (
							!definition ||
							definition.pluginSlug !== caller.pluginSlug ||
							!ownedSchemaSlugs.has(item.entitySchemaSlug)
						) {
							return yield* Effect.fail(
								`ensureUserEntities cannot write foreign entity schema: ${item.entitySchemaSlug}`,
							);
						}
					}
					return yield* entities
						.ensureUserEntities(
							UserId.make(input.authority.userId),
							items.map((item) => ({
								...item,
								entitySchemaSlug: EntitySchemaSlug.make(item.entitySchemaSlug),
							})),
							input.workflowExecutionId && input.startedAt
								? { occurredAt: input.startedAt, executionId: input.executionId }
								: undefined,
						)
						.pipe(Effect.provideService(TransactionRunner, runInTransaction));
				}),
			),
		createEvents: (rawInput, body) =>
			requireSandboxCapabilityInput(rawInput, "createEvents").pipe(
				Effect.flatMap((input) =>
					decodeCreateEventsPayload(body).pipe(
						Effect.flatMap((payload) => createEvents(input, payload)),
					),
				),
				sandboxHostEffect,
			),
		upsertGlobalEntities: (rawInput, items, options) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "upsertGlobalEntities");
					if (items.length > SANDBOX_LIMITS.globalWrites.entityItems) {
						return yield* Effect.fail(
							`upsertGlobalEntities exceeds ${SANDBOX_LIMITS.globalWrites.entityItems} items`,
						);
					}

					const parsed = yield* Effect.forEach(items, (item) => {
						const populatedAt = item.populatedAt === null ? null : new Date(item.populatedAt);
						return populatedAt === null || !Number.isNaN(populatedAt.getTime())
							? Effect.succeed({ ...item, populatedAt })
							: Effect.fail("upsertGlobalEntities populatedAt must be a valid date string");
					});

					return yield* entities
						.upsertGlobalEntities(
							parsed.map((item) => ({
								name: item.name,
								externalId: item.externalId,
								properties: item.properties,
								populatedAt: item.populatedAt,
								entitySchemaSlug: EntitySchemaSlug.make(item.entitySchemaSlug),
							})),
							input.providerId,
							options?.maximumTotal === undefined
								? undefined
								: { maximumTotal: options.maximumTotal },
						)
						.pipe(Effect.provideService(TransactionRunner, runInTransaction));
				}),
			),
		upsertGlobalRelationships: (rawInput, groups) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					yield* requireSandboxCapabilityInput(rawInput, "upsertGlobalRelationships");
					const relationshipCount = groups.reduce(
						(total, group) => total + group.relationships.length,
						0,
					);
					if (groups.length > SANDBOX_LIMITS.globalWrites.relationshipGroups) {
						return yield* Effect.fail(
							`upsertGlobalRelationships exceeds ${SANDBOX_LIMITS.globalWrites.relationshipGroups} groups`,
						);
					}
					if (relationshipCount > SANDBOX_LIMITS.globalWrites.relationshipsTotal) {
						return yield* Effect.fail(
							`upsertGlobalRelationships exceeds ${SANDBOX_LIMITS.globalWrites.relationshipsTotal} relationships`,
						);
					}

					return yield* reconcileGlobalRelationships(
						groups.map((group) => ({
							relationshipSchemaSlug: RelationshipSchemaSlug.make(group.relationshipSchemaSlug),
							relationships: group.relationships.map(toSandboxRelationshipIdentity),
							selector:
								group.selector.type === "self"
									? group.selector
									: {
											...group.selector,
											anchorEntityId: EntityId.make(group.selector.anchorEntityId),
										},
						})),
					).pipe(
						Effect.provideService(DefinitionRegistry, definitions),
						Effect.provideService(TransactionRunner, runInTransaction),
						Effect.provideService(RelationshipsRepository, relationshipsRepository),
					);
				}),
			),
		executeRyotql: (rawInput, query) =>
			requireSandboxCapabilityInput(rawInput, "executeRyotql").pipe(
				Effect.flatMap((input) => {
					const { authority } = input;
					if (authority.type === "system") {
						return Effect.gen(function* () {
							const caller = yield* runWithDb(
								pluginRuntime.resolveSystemQueryScript(SandboxScriptId.make(input.scriptId)),
							);
							if (!caller) {
								return yield* Effect.fail(
									"executeRyotql system access requires a pinned plugin script",
								);
							}
							const document = yield* decodeRyotQLDocument(query);
							return yield* ryotqlService.executeForPlugin(
								{
									pluginSlug: caller.pluginSlug,
									eventSchemas: caller.eventSchemas,
									entitySchemaSlugs: caller.entitySchemaSlugs,
									relationshipSchemaSlugs: caller.relationshipSchemaSlugs,
								},
								document,
							);
						});
					}
					return decodeRyotQLDocument(query).pipe(
						Effect.flatMap((document) =>
							ryotqlService.executeForUser(authority.userId, null, document),
						),
					);
				}),
				sandboxHostEffect,
			),
		getPluginConfig: (input, rawKeys) =>
			sandboxHostEffect(
				normalizeConfigKeys("getPluginConfig", rawKeys).pipe(
					Effect.flatMap((keys) =>
						runWithDb(
							pluginRuntime.findActivePluginConfigByScriptId(SandboxScriptId.make(input.scriptId)),
						).pipe(
							Effect.flatMap((plugin) =>
								plugin
									? getPluginConfig({
											keys,
											metadata: input.metadata,
											pluginSlug: plugin.pluginSlug,
											configSchema: plugin.configSchema,
										})
									: Effect.fail("Plugin config is available only to active plugin scripts"),
							),
							Effect.flatMap((values) => encodeConfigValues("Plugin", values)),
						),
					),
				),
			),
		getSystemConfig: (input, rawKeys) =>
			sandboxHostEffect(
				normalizeConfigKeys("getSystemConfig", rawKeys).pipe(
					Effect.flatMap((keys) =>
						getSystemConfig(keys, input.metadata).pipe(
							Effect.flatMap((values) => encodeConfigValues("System", values)),
						),
					),
				),
			),
		getEntitySchemas: (rawInput, entitySchemaSlugs) =>
			requireSandboxCapabilityInput(rawInput, "getEntitySchemas").pipe(
				Effect.andThen(
					requireUniqueNonEmptyStrings(
						entitySchemaSlugs,
						"getEntitySchemas expects non-empty entitySchemaSlugs",
					).pipe(
						Effect.flatMap((resolvedEntitySchemaSlugs) => {
							if (resolvedEntitySchemaSlugs.length === 0) {
								return Effect.succeed([]);
							}

							return Effect.forEach(resolvedEntitySchemaSlugs, (entitySchemaSlug) => {
								const definition = definitions.getEntitySchema(entitySchemaSlug);
								if (!definition) {
									return Effect.fail("Entity schema not found");
								}
								if (!definition.pluginSlug) {
									return Effect.fail("Entity schema plugin not found");
								}
								return Effect.succeed({
									definition,
									entitySchemaSlug,
									pluginSlug: definition.pluginSlug,
								});
							}).pipe(
								Effect.flatMap((schemas) =>
									runWithDb(
										Effect.gen(function* () {
											const links =
												yield* pluginRuntime.listSchemaProviders(resolvedEntitySchemaSlugs);
											const providersBySchema = new Map<
												string,
												Array<{ name: string; providerId: string }>
											>();
											for (const { entitySchemaSlug, provider } of links) {
												const providers = providersBySchema.get(entitySchemaSlug) ?? [];
												providers.push({ name: provider.name, providerId: provider.id });
												providersBySchema.set(entitySchemaSlug, providers);
											}

											return schemas.map(({ definition, entitySchemaSlug, pluginSlug }) => ({
												accentColor: definition.accentColor,
												icon: definition.icon,
												id: entitySchemaSlug,
												isBuiltin: true,
												name: definition.name,
												pluginSlug,
												propertiesSchema: toSandboxJsonValue(definition.propertiesSchema),
												providers: providersBySchema.get(entitySchemaSlug) ?? [],
												slug: definition.slug,
											}));
										}),
									).pipe(Effect.mapError(unknownToMessage)),
								),
							);
						}),
					),
				),
				sandboxHostEffect,
			),
		getCurrentIntegration: (rawInput) =>
			requireSandboxCapabilityInput(rawInput, "getCurrentIntegration").pipe(
				Effect.flatMap((input) => {
					const integrationId = sandboxRunIntegrationId(input);
					if (!integrationId) {
						return Effect.fail(
							"getCurrentIntegration is available only to executions scoped to an integration",
						);
					}

					return runWithDb(
						integrationsRepository
							.getForUser({
								userId: UserId.make(input.authority.userId),
								integrationId: IntegrationId.make(integrationId),
							})
							.pipe(
								Effect.flatMap((integration) =>
									integration
										? Effect.succeed(toSandboxIntegration(integration))
										: Effect.fail("Integration not found"),
								),
							),
					);
				}),
				sandboxHostEffect,
			),
		getUserPreferences: (rawInput) =>
			requireSandboxCapabilityInput(rawInput, "getUserPreferences").pipe(
				Effect.flatMap((input) => readUserPreferences(UserId.make(input.authority.userId))),
				sandboxHostEffect,
			),
		listEventSchemas: (rawInput, entitySchemaSlugs) =>
			requireSandboxCapabilityInput(rawInput, "listEventSchemas").pipe(
				Effect.andThen(
					requireUniqueNonEmptyStrings(
						entitySchemaSlugs,
						"listEventSchemas expects non-empty entitySchemaSlugs",
					).pipe(
						Effect.flatMap((resolvedEntitySchemaSlugs) => {
							if (resolvedEntitySchemaSlugs.length === 0) {
								return Effect.succeed([]);
							}

							return Effect.forEach(resolvedEntitySchemaSlugs, (entitySchemaSlug) => {
								const entitySchema = definitions.getEntitySchema(entitySchemaSlug);
								return entitySchema
									? Effect.succeed(
											Object.values(entitySchema.eventSchemas).map((eventSchema) => ({
												entitySchemaSlug,
												id: eventSchema.slug,
												slug: eventSchema.slug,
												name: eventSchema.name,
												propertiesSchema: toSandboxJsonValue(eventSchema.propertiesSchema),
											})),
										)
									: Effect.fail("Entity schema not found");
							}).pipe(Effect.map((schemas) => schemas.flat()));
						}),
					),
				),
				sandboxHostEffect,
			),
		listIntegrations: (rawInput, rawOptions) =>
			Effect.gen(function* () {
				const input = yield* requireSandboxCapabilityInput(rawInput, "listIntegrations");
				const options = rawOptions ?? {};

				return yield* sandboxHostEffect(
					runWithDb(
						integrationsRepository.listForUser({
							userId: UserId.make(input.authority.userId),
							...(options.provider !== undefined ? { provider: options.provider } : {}),
							...(options.isDisabled !== undefined ? { isDisabled: options.isDisabled } : {}),
						}),
					).pipe(Effect.map((rows) => rows.map(toSandboxIntegration))),
				);
			}),
	} satisfies AdditionalSandboxHostImplementationMap;
});
