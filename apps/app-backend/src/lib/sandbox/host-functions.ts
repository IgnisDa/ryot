import { eq } from "drizzle-orm";
import { Effect, Runtime, Schema } from "effect";

import { EntityId, EntitySchemaId, IntegrationId, UserId } from "#lib/schema/brands";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { CreateEventItem } from "#modules/events/schemas";
import { EventsService } from "#modules/events/service";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { isIntegrationProvider } from "#modules/integrations/types";
import { QueryDocument } from "#modules/query-engine/language";
import { QueryEngineService } from "#modules/query-engine/service";

import { AppConfig } from "../config";
import { CurrentDb, DbRunner, dbEffect } from "../db";
import * as schema from "../db/schema/auth";
import { unknownToMessage } from "../errors";
import { RedisService, redisKeys } from "../redis";
import { getSandboxAppConfigValue } from "./app-config";
import {
	apiFailure,
	apiSuccess,
	type BoundHostFunction,
	type UserSandboxRunInput,
	isObjectRecord,
	requireSandboxRunInput,
	requireUserSandboxRunInput,
} from "./shared";

type SandboxHostFunctionContext =
	| DbRunner
	| AppConfig
	| RedisService
	| EventsService
	| EntitiesRepository
	| QueryEngineService
	| IntegrationsRepository
	| EventSchemasRepository
	| EntitySchemasRepository;

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

const stableStringify = (value: unknown): string => {
	if (value === undefined) {
		return "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(Reflect.get(value, key))}`)
			.join(",")}}`;
	}

	return JSON.stringify(value);
};

const hashPayload = (payload: unknown) =>
	new Bun.CryptoHasher("sha256").update(stableStringify(payload)).digest("base64url");

const requireNonEmptyString = (value: unknown, message: string): Effect.Effect<string, string> => {
	if (typeof value !== "string" || value.trim().length === 0) {
		return Effect.fail(message);
	}

	return Effect.succeed(value.trim());
};

const normalizePreferences = (value: unknown) => {
	const source = isObjectRecord(value) ? value : {};
	const languages = isObjectRecord(source.languages) ? source.languages : {};
	const providers = Array.isArray(languages.providers)
		? languages.providers.flatMap((provider) => {
				if (!isObjectRecord(provider)) {
					return [];
				}

				const sourceValue = provider.source;
				const preferredLanguage = provider.preferredLanguage;
				if (typeof sourceValue !== "string" || typeof preferredLanguage !== "string") {
					return [];
				}

				return [{ source: sourceValue, preferredLanguage }];
			})
		: [];

	return {
		languages: { providers },
		isNsfw: source.isNsfw === true,
		disableIntegrations: source.disableIntegrations === true,
	};
};

const runHostEffect = <A>(
	runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
	effect: Effect.Effect<A, unknown>,
) =>
	runPromise(
		effect.pipe(
			Effect.map(apiSuccess),
			Effect.catchAll((error) => Effect.succeed(apiFailure(unknownToMessage(error)))),
		),
	);

export const makeAdditionalSandboxApiFunctions = (): Effect.Effect<
	Record<string, BoundHostFunction>,
	never,
	SandboxHostFunctionContext
> =>
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const runWithDb = yield* DbRunner;
		const events = yield* EventsService;
		const runtime = yield* Effect.runtime();
		const entitiesRepository = yield* EntitiesRepository;
		const queryEngineService = yield* QueryEngineService;
		const integrationsRepository = yield* IntegrationsRepository;
		const eventSchemasRepository = yield* EventSchemasRepository;
		const entitySchemasRepository = yield* EntitySchemasRepository;

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
				: events.create({
						payload,
						source: "sandbox",
						userId: UserId.make(input.userId),
						executionId: `${input.executionId}-create-events-${hashPayload(payload)}`,
					});

		return {
			claimCachedValue: (...args) => {
				const key = args[0];
				const value = args[1];
				const ttlSeconds = args[2];
				const input = requireSandboxRunInput(args, 3, "claimCachedValue");
				if (typeof key !== "string" || !key.trim()) {
					return Promise.resolve(apiFailure("claimCachedValue expects a non-empty key string"));
				}
				if (typeof ttlSeconds !== "number" || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
					return Promise.resolve(
						apiFailure("claimCachedValue expects a positive integer ttlSeconds"),
					);
				}

				const redisKey = redisKeys.sandboxCache(input.scriptId, key.trim());

				return runHostEffect(
					runPromise,
					Effect.gen(function* () {
						const serialized = yield* Schema.encode(Schema.parseJson(Schema.Unknown))(value).pipe(
							Effect.mapError(() => "claimCachedValue value must be JSON-serializable"),
						);

						const setResult = yield* Effect.tryPromise({
							try: () => redis.client.set(redisKey, serialized, "EX", ttlSeconds, "NX"),
							catch: unknownToMessage,
						});
						if (setResult !== null) {
							return { claimed: true };
						}

						const existing = yield* Effect.tryPromise({
							try: () => redis.client.get(redisKey),
							catch: unknownToMessage,
						});
						if (existing === null) {
							return { claimed: false, value: null };
						}

						return yield* Schema.decode(Schema.parseJson(Schema.Unknown))(existing).pipe(
							Effect.map((decoded) => ({ claimed: false as const, value: decoded })),
							Effect.orElseSucceed(() => ({ claimed: false as const, value: null })),
						);
					}),
				);
			},
			createEvents: (...args) => {
				const body = args[0];
				const input = requireUserSandboxRunInput(args, 1, "createEvents");
				return runHostEffect(
					runPromise,
					decodeCreateEventsPayload(body).pipe(
						Effect.flatMap((payload) => createEvents(input, payload)),
					),
				);
			},
			executeQueryEngine: (...args) => {
				const query = args[0];
				const input = requireUserSandboxRunInput(args, 1, "executeQueryEngine");

				return runHostEffect(
					runPromise,
					decodeQueryDocument(query).pipe(
						Effect.flatMap((doc) =>
							queryEngineService.execute(
								{ id: UserId.make(input.userId), name: "", email: "" },
								doc,
							),
						),
					),
				);
			},
			getAppConfigValue: (...args) => {
				const key = args[0];
				const input = requireSandboxRunInput(args, 1, "getAppConfigValue");
				if (typeof key !== "string" || !key.trim()) {
					return Promise.resolve(apiFailure("getAppConfigValue expects a non-empty key string"));
				}

				return runHostEffect(
					runPromise,
					getSandboxAppConfigValue(config, key.trim(), input.scriptIsBuiltin),
				);
			},
			getEntity: (...args) => {
				const entityId = args[0];
				const input = requireUserSandboxRunInput(args, 1, "getEntity");
				return runHostEffect(
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
										userId: UserId.make(input.userId),
										entityId: resolvedEntityId,
									}),
								);
								if (!entity) {
									return yield* Effect.fail(entityNotFoundError);
								}

								return entity;
							}),
						),
					),
				);
			},
			getEntitySchema: (...args) => {
				const entitySchemaId = args[0];
				const input = requireUserSandboxRunInput(args, 1, "getEntitySchema");
				return runHostEffect(
					runPromise,
					requireNonEmptyString(
						entitySchemaId,
						"getEntitySchema expects a non-empty entitySchemaId",
					).pipe(
						Effect.flatMap((resolvedEntitySchemaId) =>
							runWithDb(
								entitySchemasRepository
									.getByIdForUser({
										userId: UserId.make(input.userId),
										entitySchemaId: EntitySchemaId.make(resolvedEntitySchemaId),
									})
									.pipe(
										Effect.flatMap((schemaValue) =>
											schemaValue
												? Effect.succeed(schemaValue)
												: Effect.fail("Entity schema not found"),
										),
									),
							),
						),
					),
				);
			},
			getIntegration: (...args) => {
				const integrationId = args[0];
				const input = requireUserSandboxRunInput(args, 1, "getIntegration");
				return runHostEffect(
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
												? Effect.succeed(integration)
												: Effect.fail("Integration not found"),
										),
									),
							),
						),
					),
				);
			},
			getUserPreferences: (...args) => {
				const input = requireUserSandboxRunInput(args, 0, "getUserPreferences");
				return runHostEffect(runPromise, readUserPreferences(UserId.make(input.userId)));
			},
			listEventSchemas: (...args) => {
				const entitySchemaId = args[0];
				const input = requireUserSandboxRunInput(args, 1, "listEventSchemas");
				return runHostEffect(
					runPromise,
					requireNonEmptyString(
						entitySchemaId,
						"listEventSchemas expects a non-empty entitySchemaId",
					).pipe(
						Effect.flatMap((resolvedEntitySchemaId) =>
							Effect.gen(function* () {
								const entitySchema = yield* runWithDb(
									eventSchemasRepository.getEntitySchemaScopeById({
										userId: UserId.make(input.userId),
										entitySchemaId: EntitySchemaId.make(resolvedEntitySchemaId),
									}),
								);
								if (!entitySchema) {
									return yield* Effect.fail("Entity schema not found");
								}

								return yield* runWithDb(
									eventSchemasRepository.listByEntitySchemaForUser({
										userId: UserId.make(input.userId),
										entitySchemaId: EntitySchemaId.make(resolvedEntitySchemaId),
									}),
								);
							}),
						),
					),
				);
			},
			listEvents: (...args) => {
				const query = args[0];
				const input = requireUserSandboxRunInput(args, 1, "listEvents");
				return runHostEffect(
					runPromise,
					decodeListEventsQuery(query ?? {}).pipe(
						Effect.flatMap((parsedQuery) => {
							const entityId = parsedQuery.entityId
								? EntityId.make(parsedQuery.entityId)
								: undefined;
							const sessionEntityId = parsedQuery.sessionEntityId
								? EntityId.make(parsedQuery.sessionEntityId)
								: undefined;

							return events.listForUser(UserId.make(input.userId), {
								entityId,
								sessionEntityId,
								eventSchemaSlug: parsedQuery.eventSchemaSlug,
							});
						}),
					),
				);
			},
			listIntegrations: (...args) => {
				const options = args[0] ?? {};
				const input = requireUserSandboxRunInput(args, 1, "listIntegrations");
				if (!isObjectRecord(options)) {
					return Promise.resolve(apiFailure("listIntegrations expects an object"));
				}

				const provider = options.provider;
				const isDisabled = options.isDisabled;
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

				return runHostEffect(
					runPromise,
					runWithDb(
						integrationsRepository.listForUser({
							userId: UserId.make(input.userId),
							...(typeof provider === "string" ? { provider } : {}),
							...(typeof isDisabled === "boolean" ? { isDisabled } : {}),
						}),
					),
				);
			},
		};
	});
