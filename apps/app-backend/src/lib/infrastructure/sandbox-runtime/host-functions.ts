import { unknownToMessage } from "@ryot/contract/errors";
import { CreateEventItem, type CreateEventsResponse } from "@ryot/contract/modules/events/schemas";
import { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import {
	EntityId,
	EntitySchemaSlug,
	IntegrationId,
	RelationshipSchemaSlug,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { QueryEngineService } from "#modules/query-engine/service";
import { RelationshipsRepository } from "#modules/relationships/repository";
import {
	changeUserRelationships,
	reconcileGlobalRelationships,
} from "#modules/relationships/service";

import * as schema from "../db/schema/tables/combined";
import { CurrentDb, DbRunner, dbEffect, TransactionRunner } from "../db/service";
import { RedisService, redisKeys } from "../redis";
import { getPluginConfigValue, getSystemConfigValue } from "./app-config";
import {
	sandboxCacheKeyError,
	sandboxCacheTtlError,
	sandboxCacheValueError,
	SANDBOX_LIMITS,
} from "./limits";
import {
	type AdditionalSandboxHostImplementationMap,
	isJsonValue,
	requireSystemProviderSandboxRunInput,
	requireUserSandboxRunInput,
	requireSystemSandboxRunInput,
	sandboxRunIntegrationId,
	sandboxRunUserId,
	sandboxHostEffect,
	sandboxHostFailure,
	toSandboxJsonValue,
	type UserSandboxRunInput,
} from "./shared";

type SandboxHostFunctionContext =
	| DbRunner
	| RedisService
	| EventsService
	| EntitiesService
	| TransactionRunner
	| EntitiesRepository
	| DefinitionRegistry
	| QueryEngineService
	| PluginRuntimeResolver
	| IntegrationsRepository
	| RelationshipsRepository;

const entityNotFoundError = "Entity not found";

const CreateEventsPayload = Schema.Array(CreateEventItem);
const ListEventsQuery = Schema.Struct({
	entityId: Schema.optional(Schema.String),
	eventSchemaSlug: Schema.optional(Schema.String),
	sessionEntityId: Schema.optional(Schema.String),
});

const decodeListEventsQuery = Schema.decodeUnknown(ListEventsQuery);
const decodeCreateEventsPayload = Schema.decodeUnknown(CreateEventsPayload);
const decodeQueryDocument = Schema.decodeUnknown(QueryDocument);

const hashPayload = (payload: unknown) =>
	new Bun.CryptoHasher("sha256").update(stableStringify(payload)).digest("base64url");

const toSandboxIntegrationSettings = (settings: Readonly<Record<string, unknown>>) =>
	Object.fromEntries(
		Object.entries(settings).map(([key, value]) => [key, toSandboxJsonValue(value)]),
	);

const requireNonEmptyString = (value: unknown, message: string): Effect.Effect<string, string> => {
	if (typeof value !== "string" || value.trim().length === 0) {
		return Effect.fail(message);
	}

	return Effect.succeed(value.trim());
};

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

export const makeAdditionalSandboxApiFunctions = (): Effect.Effect<
	AdditionalSandboxHostImplementationMap,
	never,
	SandboxHostFunctionContext
> =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const runWithDb = yield* DbRunner;
		const events = yield* EventsService;
		const entities = yield* EntitiesService;
		const definitions = yield* DefinitionRegistry;
		const runInTransaction = yield* TransactionRunner;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const entitiesRepository = yield* EntitiesRepository;
		const queryEngineService = yield* QueryEngineService;
		const integrationsRepository = yield* IntegrationsRepository;
		const relationshipsRepository = yield* RelationshipsRepository;

		const requireReadableEntity = (userId: UserId, entityId: EntityId, notFoundMessage: string) =>
			runWithDb(
				entitiesRepository
					.getEntityScopeForUser({ userId, entityId })
					.pipe(
						Effect.flatMap((scope) =>
							scope ? Effect.succeed(scope) : Effect.fail(notFoundMessage),
						),
					),
			);

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
						const input = yield* requireUserSandboxRunInput(rawInput, "changeUserRelationships");
						if (input.authority.type !== "user") {
							return yield* Effect.fail(
								"changeUserRelationships is available only to user executions",
							);
						}
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
								creates: batch.creates.map((create) => ({
									...create,
									sourceEntityId: EntityId.make(create.sourceEntityId),
									targetEntityId: EntityId.make(create.targetEntityId),
									relationshipSchemaSlug: RelationshipSchemaSlug.make(
										create.relationshipSchemaSlug,
									),
								})),
								deletes: batch.deletes.map((remove) => ({
									...remove,
									sourceEntityId: EntityId.make(remove.sourceEntityId),
									targetEntityId: EntityId.make(remove.targetEntityId),
									relationshipSchemaSlug: RelationshipSchemaSlug.make(
										remove.relationshipSchemaSlug,
									),
								})),
							})),
						).pipe(
							Effect.provideService(DefinitionRegistry, definitions),
							Effect.provideService(EntitiesRepository, entitiesRepository),
							Effect.provideService(TransactionRunner, runInTransaction),
							Effect.provideService(RelationshipsRepository, relationshipsRepository),
						);
					}),
				),
			claimCachedValue: (input, key, value, ttlSeconds) => {
				const keyError = sandboxCacheKeyError("claimCachedValue", key);
				if (keyError) {
					return sandboxHostFailure(keyError);
				}
				const ttlError = sandboxCacheTtlError("claimCachedValue", ttlSeconds, "TTL");
				if (ttlError) {
					return sandboxHostFailure(ttlError);
				}

				const redisKey = redisKeys.sandboxCache(
					sandboxRunUserId(input),
					input.cacheNamespace,
					key.trim(),
				);

				return sandboxHostEffect(
					Effect.gen(function* () {
						const serialized = yield* Schema.encode(Schema.parseJson(Schema.Unknown))(value).pipe(
							Effect.mapError(() => "claimCachedValue value must be JSON-serializable"),
						);
						const valueError = sandboxCacheValueError("claimCachedValue", serialized);
						if (valueError) {
							return yield* Effect.fail(valueError);
						}

						const setResult = yield* Effect.tryPromise({
							try: () => redis.client.set(redisKey, serialized, "EX", ttlSeconds, "NX"),
							catch: unknownToMessage,
						});
						if (setResult !== null) {
							return { claimed: true as const };
						}

						const existing = yield* Effect.tryPromise({
							try: () => redis.client.get(redisKey),
							catch: unknownToMessage,
						});
						if (existing === null) {
							return { claimed: false, value: null };
						}
						const existingValueError = sandboxCacheValueError(
							"claimCachedValue",
							existing,
							"stored value",
						);
						if (existingValueError) {
							return yield* Effect.fail(existingValueError);
						}

						return yield* Schema.decode(Schema.parseJson(Schema.Unknown))(existing).pipe(
							Effect.map((decoded) => ({
								claimed: false as const,
								value: isJsonValue(decoded) ? decoded : null,
							})),
							Effect.orElseSucceed(() => ({ claimed: false as const, value: null })),
						);
					}),
				);
			},
			createEvents: (rawInput, body) =>
				requireUserSandboxRunInput(rawInput, "createEvents").pipe(
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
						const input = yield* requireSystemProviderSandboxRunInput(
							rawInput,
							"upsertGlobalEntities",
						);
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
						yield* requireSystemSandboxRunInput(rawInput, "upsertGlobalRelationships");
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
								relationships: group.relationships.map((relationship) => ({
									...relationship,
									sourceEntityId: EntityId.make(relationship.sourceEntityId),
									targetEntityId: EntityId.make(relationship.targetEntityId),
								})),
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
			executeQueryEngine: (rawInput, query) => {
				if (rawInput.authority.type === "system") {
					return sandboxHostEffect(
						Effect.gen(function* () {
							const caller = yield* runWithDb(
								pluginRuntime.resolveSystemQueryActivity(SandboxScriptId.make(rawInput.scriptId)),
							);
							if (!caller) {
								return yield* Effect.fail(
									"executeQueryEngine system access requires a pinned plugin activity script",
								);
							}
							const doc = yield* decodeQueryDocument(query);
							return yield* queryEngineService.executeSystem(caller, doc);
						}),
					);
				}
				return requireUserSandboxRunInput(rawInput, "executeQueryEngine").pipe(
					Effect.flatMap((input) =>
						decodeQueryDocument(query).pipe(
							Effect.flatMap((doc) =>
								queryEngineService.executeForUser(UserId.make(input.authority.userId), null, doc),
							),
						),
					),
					sandboxHostEffect,
				);
			},
			getPluginConfigValue: (input, key) => {
				if (typeof key !== "string" || !key.trim()) {
					return sandboxHostFailure("getPluginConfigValue expects a non-empty key string");
				}

				return sandboxHostEffect(
					runWithDb(
						pluginRuntime.findActivePluginConfigByScriptId(SandboxScriptId.make(input.scriptId)),
					).pipe(
						Effect.flatMap((plugin) =>
							plugin
								? getPluginConfigValue({
										key: key.trim(),
										metadata: input.metadata,
										pluginSlug: plugin.pluginSlug,
										configSchema: plugin.configSchema,
									})
								: Effect.fail("Plugin config is available only to active plugin scripts"),
						),
						Effect.flatMap((value) =>
							isJsonValue(value)
								? Effect.succeed(value)
								: Effect.fail(`Plugin config key "${key.trim()}" is not JSON-compatible`),
						),
					),
				);
			},
			getSystemConfigValue: (input, key) => {
				if (typeof key !== "string" || !key.trim()) {
					return sandboxHostFailure("getSystemConfigValue expects a non-empty key string");
				}
				return sandboxHostEffect(
					getSystemConfigValue(key.trim(), input.metadata).pipe(
						Effect.flatMap((value) =>
							isJsonValue(value)
								? Effect.succeed(value)
								: Effect.fail(`System config key "${key.trim()}" is not JSON-compatible`),
						),
					),
				);
			},
			getEntity: (rawInput, entityId) =>
				requireUserSandboxRunInput(rawInput, "getEntity").pipe(
					Effect.flatMap((input) =>
						requireNonEmptyString(entityId, "getEntity expects a non-empty entityId").pipe(
							Effect.flatMap((rawEntityId) =>
								Effect.gen(function* () {
									const resolvedEntityId = EntityId.make(rawEntityId);
									yield* requireReadableEntity(
										UserId.make(input.authority.userId),
										resolvedEntityId,
										entityNotFoundError,
									);
									const entity = yield* runWithDb(
										entitiesRepository.getByIdForUser({
											entityId: resolvedEntityId,
											userId: UserId.make(input.authority.userId),
										}),
									);
									if (!entity) {
										return yield* Effect.fail(entityNotFoundError);
									}

									return {
										id: entity.id,
										name: entity.name,
										createdAt: entity.createdAt,
										updatedAt: entity.updatedAt,
										externalId: entity.externalId,
										providerId: entity.providerId,
										populatedAt: entity.populatedAt,
										entitySchemaSlug: entity.entitySchemaSlug,
										properties: toSandboxJsonValue(entity.properties),
									};
								}),
							),
						),
					),
					sandboxHostEffect,
				),
			getEntitySchema: (rawInput, entitySchemaSlug) =>
				requireUserSandboxRunInput(rawInput, "getEntitySchema").pipe(
					Effect.zipRight(
						requireNonEmptyString(
							entitySchemaSlug,
							"getEntitySchema expects a non-empty entitySchemaSlug",
						).pipe(
							Effect.flatMap((resolvedEntitySchemaSlug) => {
								const definition = definitions.getEntitySchema(resolvedEntitySchemaSlug);
								if (!definition) {
									return Effect.fail("Entity schema not found");
								}
								if (!definition.pluginSlug) {
									return Effect.fail("Entity schema plugin not found");
								}
								const pluginSlug = definition.pluginSlug;
								return runWithDb(
									Effect.gen(function* () {
										const links = yield* pluginRuntime.listSchemaProviders([
											resolvedEntitySchemaSlug,
										]);
										const providers = links.map(({ provider }) => ({
											name: provider.name,
											providerId: provider.id,
										}));
										return {
											...definition,
											providers,
											pluginSlug,
											isBuiltin: true,
											id: resolvedEntitySchemaSlug,
											propertiesSchema: toSandboxJsonValue(definition.propertiesSchema),
										};
									}),
								).pipe(Effect.mapError(unknownToMessage));
							}),
						),
					),
					sandboxHostEffect,
				),
			getIntegration: (rawInput) =>
				requireUserSandboxRunInput(rawInput, "getIntegration").pipe(
					Effect.flatMap((input) => {
						const integrationId = sandboxRunIntegrationId(input);
						if (!integrationId) {
							return Effect.fail(
								"getIntegration is available only to executions scoped to an integration",
							);
						}

						return runWithDb(
							integrationsRepository
								.getForUser({
									integrationId: IntegrationId.make(integrationId),
									userId: UserId.make(input.authority.userId),
								})
								.pipe(
									Effect.flatMap((integration) =>
										integration
											? Effect.succeed({
													...integration,
													providerSpecifics: toSandboxIntegrationSettings(
														integration.providerSpecifics,
													),
												})
											: Effect.fail("Integration not found"),
									),
								),
						);
					}),
					sandboxHostEffect,
				),
			getUserPreferences: (rawInput) =>
				requireUserSandboxRunInput(rawInput, "getUserPreferences").pipe(
					Effect.flatMap((input) => readUserPreferences(UserId.make(input.authority.userId))),
					sandboxHostEffect,
				),
			listEventSchemas: (rawInput, entitySchemaSlug) =>
				requireUserSandboxRunInput(rawInput, "listEventSchemas").pipe(
					Effect.zipRight(
						requireNonEmptyString(
							entitySchemaSlug,
							"listEventSchemas expects a non-empty entitySchemaSlug",
						).pipe(
							Effect.flatMap((resolvedEntitySchemaSlug) => {
								const entitySchema = definitions.getEntitySchema(resolvedEntitySchemaSlug);
								return entitySchema
									? Effect.succeed(
											Object.values(entitySchema.eventSchemas).map((eventSchema) => ({
												id: eventSchema.slug,
												slug: eventSchema.slug,
												name: eventSchema.name,
												entitySchemaSlug: resolvedEntitySchemaSlug,
												propertiesSchema: toSandboxJsonValue(eventSchema.propertiesSchema),
											})),
										)
									: Effect.fail("Entity schema not found");
							}),
						),
					),
					sandboxHostEffect,
				),
			listEvents: (rawInput, query) =>
				requireUserSandboxRunInput(rawInput, "listEvents").pipe(
					Effect.flatMap((input) =>
						decodeListEventsQuery(query ?? {}).pipe(
							Effect.flatMap((parsedQuery) => {
								const entityId = parsedQuery.entityId
									? EntityId.make(parsedQuery.entityId)
									: undefined;
								const sessionEntityId = parsedQuery.sessionEntityId
									? EntityId.make(parsedQuery.sessionEntityId)
									: undefined;

								return events
									.listForUser(UserId.make(input.authority.userId), {
										entityId,
										sessionEntityId,
										eventSchemaSlug: parsedQuery.eventSchemaSlug,
									})
									.pipe(
										Effect.map((rows) =>
											rows.map((event) => ({
												...event,
												properties: toSandboxJsonValue(event.properties),
											})),
										),
									);
							}),
						),
					),
					sandboxHostEffect,
				),
			listIntegrations: (rawInput, rawOptions) =>
				Effect.gen(function* () {
					const input = yield* requireUserSandboxRunInput(rawInput, "listIntegrations");
					const options = rawOptions ?? {};
					if (!isObjectRecord(options)) {
						return yield* sandboxHostFailure("listIntegrations expects an object");
					}

					const provider = options["provider"];
					const isDisabled = options["isDisabled"];
					if (provider !== undefined && typeof provider !== "string") {
						return yield* sandboxHostFailure("listIntegrations provider must be a string");
					}
					if (isDisabled !== undefined && typeof isDisabled !== "boolean") {
						return yield* sandboxHostFailure("listIntegrations isDisabled must be a boolean");
					}

					return yield* sandboxHostEffect(
						runWithDb(
							integrationsRepository.listForUser({
								userId: UserId.make(input.authority.userId),
								...(typeof provider === "string" ? { provider } : {}),
								...(typeof isDisabled === "boolean" ? { isDisabled } : {}),
							}),
						).pipe(
							Effect.map((rows) =>
								rows.map((integration) => ({
									...integration,
									providerSpecifics: toSandboxIntegrationSettings(integration.providerSpecifics),
								})),
							),
						),
					);
				}),
		} satisfies AdditionalSandboxHostImplementationMap;
	});
