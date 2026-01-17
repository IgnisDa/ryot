import { defaultUserPreferences } from "@ryot/contract/auth-middleware";
import { unknownToMessage } from "@ryot/contract/errors";
import { CreateEventItem, type CreateEventsResponse } from "@ryot/contract/modules/events/schemas";
import { isIntegrationProvider } from "@ryot/contract/modules/integrations/types";
import { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import { EntityId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { eq } from "drizzle-orm";
import { Effect, Runtime, Schema } from "effect";

import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsService } from "#modules/events/service";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { QueryEngineService } from "#modules/query-engine/service";

import { AppConfig } from "../config/service";
import * as schema from "../db/schema/tables/combined";
import { CurrentDb, DbRunner, dbEffect } from "../db/service";
import { RedisService, redisKeys } from "../redis";
import { getSandboxAppConfigValue } from "./app-config";
import { sandboxCacheKeyError, sandboxCacheTtlError, sandboxCacheValueError } from "./limits";
import {
	apiFailure,
	type AdditionalSandboxHostImplementationMap,
	isJsonValue,
	toSandboxJsonValue,
	type UserSandboxRunInput,
	requireUserSandboxRunInput,
	runSandboxHostEffect,
} from "./shared";

type SandboxHostFunctionContext =
	| DbRunner
	| AppConfig
	| RedisService
	| EventsService
	| EntitiesRepository
	| DefinitionRegistry
	| QueryEngineService
	| PluginRuntimeResolver
	| IntegrationsRepository;

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
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const runWithDb = yield* DbRunner;
		const events = yield* EventsService;
		const runtime = yield* Effect.runtime();
		const definitions = yield* DefinitionRegistry;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const entitiesRepository = yield* EntitiesRepository;
		const queryEngineService = yield* QueryEngineService;
		const integrationsRepository = yield* IntegrationsRepository;

		const runPromise = Runtime.runPromise(runtime);

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
							userId: UserId.make(input.userId),
							executionId: `${input.executionId}-create-events-${hashPayload(payload)}`,
						})
						.pipe(Effect.flatMap(toSandboxCreateEventsResult));

		return {
			claimCachedValue: (input, key, value, ttlSeconds) => {
				const keyError = sandboxCacheKeyError("claimCachedValue", key);
				if (keyError) {
					return Promise.resolve(apiFailure(keyError));
				}
				const ttlError = sandboxCacheTtlError("claimCachedValue", ttlSeconds, "TTL");
				if (ttlError) {
					return Promise.resolve(apiFailure(ttlError));
				}

				const redisKey = redisKeys.sandboxCache(input.scriptId, key.trim());

				return runSandboxHostEffect(
					runPromise,
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
			createEvents: (rawInput, body) => {
				const input = requireUserSandboxRunInput(rawInput, "createEvents");
				return runSandboxHostEffect(
					runPromise,
					decodeCreateEventsPayload(body).pipe(
						Effect.flatMap((payload) => createEvents(input, payload)),
					),
				);
			},
			executeQueryEngine: (rawInput, query) => {
				const input = requireUserSandboxRunInput(rawInput, "executeQueryEngine");

				return runSandboxHostEffect(
					runPromise,
					decodeQueryDocument(query).pipe(
						Effect.flatMap((doc) =>
							queryEngineService.execute(
								{
									name: "",
									email: "",
									id: UserId.make(input.userId),
									preferences: defaultUserPreferences,
								},
								doc,
							),
						),
					),
				);
			},
			getAppConfigValue: (input, key) => {
				if (typeof key !== "string" || !key.trim()) {
					return Promise.resolve(apiFailure("getAppConfigValue expects a non-empty key string"));
				}

				return runSandboxHostEffect(
					runPromise,
					getSandboxAppConfigValue(config, key.trim(), input.scriptIsBuiltin).pipe(
						Effect.flatMap((value) =>
							isJsonValue(value)
								? Effect.succeed(value)
								: Effect.fail(`Config key "${key.trim()}" is not JSON-compatible`),
						),
					),
				);
			},
			getEntity: (rawInput, entityId) => {
				const input = requireUserSandboxRunInput(rawInput, "getEntity");
				return runSandboxHostEffect(
					runPromise,
					requireNonEmptyString(entityId, "getEntity expects a non-empty entityId").pipe(
						Effect.flatMap((rawEntityId) =>
							Effect.gen(function* () {
								const resolvedEntityId = EntityId.make(rawEntityId);
								yield* requireReadableEntity(
									UserId.make(input.userId),
									resolvedEntityId,
									entityNotFoundError,
								);
								const entity = yield* runWithDb(
									entitiesRepository.getByIdForUser({
										entityId: resolvedEntityId,
										userId: UserId.make(input.userId),
									}),
								);
								if (!entity) {
									return yield* Effect.fail(entityNotFoundError);
								}

								return { ...entity, properties: toSandboxJsonValue(entity.properties) };
							}),
						),
					),
				);
			},
			getEntitySchema: (rawInput, entitySchemaSlug) => {
				requireUserSandboxRunInput(rawInput, "getEntitySchema");
				return runSandboxHostEffect(
					runPromise,
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
									const links = yield* pluginRuntime.listSchemaScripts([resolvedEntitySchemaSlug]);
									const providers = links.map(({ script }) => ({
										name: script.name,
										scriptId: script.id,
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
				);
			},
			getIntegration: (rawInput, integrationId) => {
				const input = requireUserSandboxRunInput(rawInput, "getIntegration");
				return runSandboxHostEffect(
					runPromise,
					requireNonEmptyString(
						integrationId,
						"getIntegration expects a non-empty integrationId",
					).pipe(
						Effect.flatMap((resolvedIntegrationId) =>
							runWithDb(
								integrationsRepository
									.getForUser({
										userId: UserId.make(input.userId),
										integrationId: IntegrationId.make(resolvedIntegrationId),
									})
									.pipe(
										Effect.flatMap((integration) =>
											integration
												? Effect.succeed({
														...integration,
														providerSpecifics: toSandboxJsonValue(integration.providerSpecifics),
													})
												: Effect.fail("Integration not found"),
										),
									),
							),
						),
					),
				);
			},
			getUserPreferences: (rawInput) => {
				const input = requireUserSandboxRunInput(rawInput, "getUserPreferences");
				return runSandboxHostEffect(runPromise, readUserPreferences(UserId.make(input.userId)));
			},
			listEventSchemas: (rawInput, entitySchemaSlug) => {
				requireUserSandboxRunInput(rawInput, "listEventSchemas");
				return runSandboxHostEffect(
					runPromise,
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
				);
			},
			listEvents: (rawInput, query) => {
				const input = requireUserSandboxRunInput(rawInput, "listEvents");
				return runSandboxHostEffect(
					runPromise,
					decodeListEventsQuery(query ?? {}).pipe(
						Effect.flatMap((parsedQuery) => {
							const entityId = parsedQuery.entityId
								? EntityId.make(parsedQuery.entityId)
								: undefined;
							const sessionEntityId = parsedQuery.sessionEntityId
								? EntityId.make(parsedQuery.sessionEntityId)
								: undefined;

							return events
								.listForUser(UserId.make(input.userId), {
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
				);
			},
			listIntegrations: (rawInput, rawOptions) => {
				const input = requireUserSandboxRunInput(rawInput, "listIntegrations");
				const options = rawOptions ?? {};
				if (!isObjectRecord(options)) {
					return Promise.resolve(apiFailure("listIntegrations expects an object"));
				}

				const provider = options["provider"];
				const isDisabled = options["isDisabled"];
				if (provider !== undefined && typeof provider !== "string") {
					return Promise.resolve(apiFailure("listIntegrations provider must be a string"));
				}
				if (typeof provider === "string" && !isIntegrationProvider(provider)) {
					return Promise.resolve(
						apiFailure("listIntegrations provider must be a supported provider"),
					);
				}
				if (isDisabled !== undefined && typeof isDisabled !== "boolean") {
					return Promise.resolve(apiFailure("listIntegrations isDisabled must be a boolean"));
				}

				return runSandboxHostEffect(
					runPromise,
					runWithDb(
						integrationsRepository.listForUser({
							userId: UserId.make(input.userId),
							...(typeof provider === "string" ? { provider } : {}),
							...(typeof isDisabled === "boolean" ? { isDisabled } : {}),
						}),
					).pipe(
						Effect.map((rows) =>
							rows.map((integration) => ({
								...integration,
								providerSpecifics: toSandboxJsonValue(integration.providerSpecifics),
							})),
						),
					),
				);
			},
		} satisfies AdditionalSandboxHostImplementationMap;
	});
