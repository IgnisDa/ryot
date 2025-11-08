import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";

import type { EntitiesRepository } from "~/modules/entities/repository";
import type { EntitySchemasRepository } from "~/modules/entity-schemas/repository";
import type { EventSchemasRepository } from "~/modules/event-schemas/repository";
import { createEventsForUser } from "~/modules/events/create-core";
import type { EventsRepository } from "~/modules/events/repository";
import { CreateEventItem } from "~/modules/events/schemas";
import type { IntegrationsRepository } from "~/modules/integrations/repository";
import { isIntegrationProvider } from "~/modules/integrations/types";
import type { SandboxRepository } from "~/modules/sandbox/repository";

import type { AppConfigValue } from "./config";
import { isOidcEnabled } from "./config";
import { CurrentDb, dbEffect, type DbRunner, schema } from "./db";
import { type SandboxRunError, type TimeoutError, unknownToMessage } from "./errors";
import type { RedisService } from "./redis";
import { redisKeys } from "./redis";
import type { SandboxRunInput, SandboxRunOutput } from "./sandbox";
import {
	apiFailure,
	apiSuccess,
	type BoundHostFunction,
	requireSandboxRunInput,
} from "./sandbox-shared";

type SandboxHostFunctionDependencies = {
	readonly redis: RedisService;
	readonly config: AppConfigValue;
	readonly runWithDb: DbRunner["Type"];
	readonly eventsRepository: EventsRepository;
	readonly sandboxRepository: SandboxRepository;
	readonly workflowEngine: WorkflowEngine["Type"];
	readonly entitiesRepository: EntitiesRepository;
	readonly integrationsRepository: IntegrationsRepository;
	readonly eventSchemasRepository: EventSchemasRepository;
	readonly entitySchemasRepository: EntitySchemasRepository;
	readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
	readonly runSandboxScript: (
		input: SandboxRunInput,
	) => Effect.Effect<SandboxRunOutput, SandboxRunError | TimeoutError>;
};

const entityNotFoundError = "Entity not found";
const sessionEntityNotFoundError = "Session entity not found";
const listScopeRequiredError = "Either entityId or sessionEntityId is required";

const dotPathToEnvKey = (path: string): string =>
	path
		.split(".")
		.map((segment) => segment.replace(/([A-Z])/g, "_$1").toUpperCase())
		.join("_");

const CreateEventsPayload = Schema.Array(CreateEventItem);
const ListEventsQuery = Schema.Struct({
	entityId: Schema.optional(Schema.String),
	eventSchemaSlug: Schema.optional(Schema.String),
	sessionEntityId: Schema.optional(Schema.String),
});

const decodeListEventsQuery = Schema.decodeUnknown(ListEventsQuery);
const decodeCreateEventsPayload = Schema.decodeUnknown(CreateEventsPayload);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

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

const requireReadableEntity = (
	deps: SandboxHostFunctionDependencies,
	userId: string,
	entityId: string,
	notFoundMessage: string,
) =>
	Effect.gen(function* () {
		const scope = yield* deps.runWithDb(
			deps.entitiesRepository.getEntityScopeForUser({ userId, entityId }),
		);
		if (!scope) {
			return yield* Effect.fail(notFoundMessage);
		}

		return scope;
	});

const readUserPreferences = (deps: SandboxHostFunctionDependencies, userId: string) =>
	deps.runWithDb(
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

const runHostEffect = <A>(
	deps: SandboxHostFunctionDependencies,
	effect: Effect.Effect<A, unknown>,
) =>
	deps.runPromise(
		effect.pipe(
			Effect.map(apiSuccess),
			Effect.catchAll((error) => Effect.succeed(apiFailure(unknownToMessage(error)))),
		),
	);

export const makeAdditionalSandboxApiFunctions = (
	deps: SandboxHostFunctionDependencies,
): Record<string, BoundHostFunction> => ({
	claimCachedValue: (...args) => {
		const key = args[0];
		const value = args[1];
		const ttlSeconds = args[2];
		const input = requireSandboxRunInput(args, 3, "claimCachedValue");
		if (typeof key !== "string" || !key.trim()) {
			return Promise.resolve(apiFailure("claimCachedValue expects a non-empty key string"));
		}
		if (typeof ttlSeconds !== "number" || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
			return Promise.resolve(apiFailure("claimCachedValue expects a positive integer ttlSeconds"));
		}

		const redisKey = redisKeys.sandboxCache(input.scriptId, key.trim());

		return runHostEffect(
			deps,
			Effect.gen(function* () {
				const serialized = yield* Schema.encode(Schema.parseJson(Schema.Unknown))(value).pipe(
					Effect.mapError(() => "claimCachedValue value must be JSON-serializable"),
				);

				const setResult = yield* Effect.tryPromise({
					try: () => deps.redis.client.set(redisKey, serialized, "EX", ttlSeconds, "NX"),
					catch: unknownToMessage,
				});
				if (setResult !== null) {
					return { claimed: true };
				}

				const existing = yield* Effect.tryPromise({
					try: () => deps.redis.client.get(redisKey),
					catch: unknownToMessage,
				});
				if (existing === null) {
					return { claimed: false, value: null };
				}

				const parsed = yield* Schema.decode(Schema.parseJson(Schema.Unknown))(existing).pipe(
					Effect.map((decoded) => ({ claimed: false as const, value: decoded })),
					Effect.orElseSucceed(() => ({ claimed: false as const, value: null })),
				);
				return parsed;
			}),
		);
	},
	createEvents: (...args) => {
		const body = args[0];
		const input = requireSandboxRunInput(args, 1, "createEvents");
		return runHostEffect(
			deps,
			decodeCreateEventsPayload(body).pipe(
				Effect.flatMap((payload) =>
					createEventsForUser(deps, { userId: input.userId, origin: "sandbox", payload }),
				),
			),
		);
	},
	getAppConfigValue: (...args) => {
		const key = args[0];
		if (typeof key !== "string" || !key.trim()) {
			return Promise.resolve(apiFailure("getAppConfigValue expects a non-empty key string"));
		}

		const envKey = dotPathToEnvKey(key.trim());
		const value = Bun.env[envKey];
		if (value === undefined) {
			return Promise.resolve(apiFailure(`Config key "${key.trim()}" does not exist`));
		}

		return Promise.resolve(apiSuccess(value));
	},
	getEntity: (...args) => {
		const entityId = args[0];
		const input = requireSandboxRunInput(args, 1, "getEntity");
		return runHostEffect(
			deps,
			requireNonEmptyString(entityId, "getEntity expects a non-empty entityId").pipe(
				Effect.flatMap((resolvedEntityId) =>
					Effect.gen(function* () {
						yield* requireReadableEntity(deps, input.userId, resolvedEntityId, entityNotFoundError);
						const entity = yield* deps.runWithDb(
							deps.entitiesRepository.getByIdForUser({
								userId: input.userId,
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
		const input = requireSandboxRunInput(args, 1, "getEntitySchema");
		return runHostEffect(
			deps,
			requireNonEmptyString(
				entitySchemaId,
				"getEntitySchema expects a non-empty entitySchemaId",
			).pipe(
				Effect.flatMap((resolvedEntitySchemaId) =>
					deps
						.runWithDb(
							deps.entitySchemasRepository.getByIdForUser({
								userId: input.userId,
								entitySchemaId: resolvedEntitySchemaId,
							}),
						)
						.pipe(
							Effect.flatMap((schemaValue) =>
								schemaValue ? Effect.succeed(schemaValue) : Effect.fail("Entity schema not found"),
							),
						),
				),
			),
		);
	},
	getIntegration: (...args) => {
		const integrationId = args[0];
		const input = requireSandboxRunInput(args, 1, "getIntegration");
		return runHostEffect(
			deps,
			requireNonEmptyString(integrationId, "getIntegration expects a non-empty integrationId").pipe(
				Effect.flatMap((resolvedIntegrationId) =>
					deps
						.runWithDb(
							deps.integrationsRepository.getForUser({
								userId: input.userId,
								integrationId: resolvedIntegrationId,
							}),
						)
						.pipe(
							Effect.flatMap((integration) =>
								integration ? Effect.succeed(integration) : Effect.fail("Integration not found"),
							),
						),
				),
			),
		);
	},
	getSystemConfig: () =>
		Promise.resolve(
			apiSuccess({
				system: {
					scheduler: {
						progressUpdateThresholdHours: String(
							deps.config.scheduler.progressUpdateThresholdHours,
						),
					},
				},
				auth: {
					oidcEnabled: isOidcEnabled(deps.config),
					localAuthDisabled: deps.config.users.disableLocalAuth,
					signupAllowed: deps.config.users.allowRegistration && !deps.config.users.disableLocalAuth,
					...(Option.isSome(deps.config.frontend.oidcButtonLabel) &&
					deps.config.frontend.oidcButtonLabel.value.length > 0
						? { oidcButtonLabel: deps.config.frontend.oidcButtonLabel.value }
						: {}),
				},
			}),
		),
	getUserPreferences: (...args) => {
		const input = requireSandboxRunInput(args, 0, "getUserPreferences");
		return runHostEffect(deps, readUserPreferences(deps, input.userId));
	},
	listEventSchemas: (...args) => {
		const entitySchemaId = args[0];
		const input = requireSandboxRunInput(args, 1, "listEventSchemas");
		return runHostEffect(
			deps,
			requireNonEmptyString(
				entitySchemaId,
				"listEventSchemas expects a non-empty entitySchemaId",
			).pipe(
				Effect.flatMap((resolvedEntitySchemaId) =>
					Effect.gen(function* () {
						const entitySchema = yield* deps.runWithDb(
							deps.eventSchemasRepository.getEntitySchemaScopeById({
								userId: input.userId,
								entitySchemaId: resolvedEntitySchemaId,
							}),
						);
						if (!entitySchema) {
							return yield* Effect.fail("Entity schema not found");
						}

						return yield* deps.runWithDb(
							deps.eventSchemasRepository.listByEntitySchemaForUser({
								userId: input.userId,
								entitySchemaId: resolvedEntitySchemaId,
							}),
						);
					}),
				),
			),
		);
	},
	listEvents: (...args) => {
		const query = args[0];
		const input = requireSandboxRunInput(args, 1, "listEvents");
		return runHostEffect(
			deps,
			decodeListEventsQuery(query ?? {}).pipe(
				Effect.flatMap((parsedQuery) =>
					Effect.gen(function* () {
						if (!parsedQuery.entityId && !parsedQuery.sessionEntityId) {
							return yield* Effect.fail(listScopeRequiredError);
						}

						if (parsedQuery.entityId) {
							yield* requireReadableEntity(
								deps,
								input.userId,
								parsedQuery.entityId,
								entityNotFoundError,
							);
						}

						if (parsedQuery.sessionEntityId) {
							yield* requireReadableEntity(
								deps,
								input.userId,
								parsedQuery.sessionEntityId,
								sessionEntityNotFoundError,
							);
						}

						return yield* deps.runWithDb(
							deps.eventsRepository.listForUser({ userId: input.userId, ...parsedQuery }),
						);
					}),
				),
			),
		);
	},
	listIntegrations: (...args) => {
		const options = args[0] ?? {};
		const input = requireSandboxRunInput(args, 1, "listIntegrations");
		if (!isObjectRecord(options)) {
			return Promise.resolve(apiFailure("listIntegrations expects an object"));
		}

		const provider = options.provider;
		const isDisabled = options.isDisabled;
		if (provider !== undefined && typeof provider !== "string") {
			return Promise.resolve(apiFailure("listIntegrations provider must be a string"));
		}
		if (typeof provider === "string" && !isIntegrationProvider(provider)) {
			return Promise.resolve(apiFailure("listIntegrations provider must be a supported provider"));
		}
		if (isDisabled !== undefined && typeof isDisabled !== "boolean") {
			return Promise.resolve(apiFailure("listIntegrations isDisabled must be a boolean"));
		}

		return runHostEffect(
			deps,
			deps.runWithDb(
				deps.integrationsRepository.listForUser({
					userId: input.userId,
					...(typeof provider === "string" ? { provider } : {}),
					...(typeof isDisabled === "boolean" ? { isDisabled } : {}),
				}),
			),
		);
	},
});
