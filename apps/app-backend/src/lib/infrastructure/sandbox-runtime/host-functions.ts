import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { unknownToMessage } from "@ryot/contract/errors";
import { EmitSignalPayload } from "@ryot/contract/modules/automations/schemas";
import { CreateEventItem } from "@ryot/contract/modules/events/schemas";
import { isIntegrationProvider } from "@ryot/contract/modules/integrations/types";
import { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import {
	EntityId,
	EntitySchemaId,
	IntegrationId,
	SignalId,
	UserId,
} from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Runtime, Schema } from "effect";

import { AutomationsRepository } from "#modules/automations/repository";
import { AutomationsService } from "#modules/automations/service";
import { emitAndDispatchSignal } from "#modules/automations/signal-dispatch";
import { defaultUserPreferences } from "#modules/builtins/bootstrap";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { QueryEngineService } from "#modules/query-engine/service";

import { AppConfig } from "../config/service";
import * as schema from "../db/schema/tables/auth";
import { CurrentDb, DbRunner, dbEffect } from "../db/service";
import type { RedisService } from "../redis";
import { getSandboxAppConfigValue } from "./app-config";
import { makeCacheSandboxApiFunctions } from "./cache-host-functions";
import { finishAutomationEffect, reserveAutomationEffect } from "./effect-ledger";
import { makeNotificationSandboxApiFunctions } from "./notification-host-functions";
import {
	apiFailure,
	type BoundHostFunction,
	type UserSandboxRunInput,
	requireSandboxRunInput,
	requireUserSandboxRunInput,
	runHostEffect,
} from "./shared";

type SandboxHostFunctionContext =
	| DbRunner
	| AppConfig
	| RedisService
	| EventsService
	| WorkflowEngine
	| AutomationsService
	| EntitiesRepository
	| QueryEngineService
	| AutomationsRepository
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
const decodeEmitSignalPayload = Schema.decodeUnknown(EmitSignalPayload);

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
	return {
		isNsfw: source["isNsfw"] === true,
		disableIntegrations: source["disableIntegrations"] === true,
	};
};

export const makeAdditionalSandboxApiFunctions = (): Effect.Effect<
	Record<string, BoundHostFunction>,
	never,
	SandboxHostFunctionContext
> =>
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const runWithDb = yield* DbRunner;
		const events = yield* EventsService;
		const engine = yield* WorkflowEngine;
		const runtime = yield* Effect.runtime();
		const automations = yield* AutomationsService;
		const entitiesRepository = yield* EntitiesRepository;
		const queryEngineService = yield* QueryEngineService;
		const automationsRepository = yield* AutomationsRepository;
		const integrationsRepository = yield* IntegrationsRepository;
		const eventSchemasRepository = yield* EventSchemasRepository;
		const entitySchemasRepository = yield* EntitySchemasRepository;

		const runPromise = Runtime.runPromise(runtime);
		const cacheFunctions = yield* makeCacheSandboxApiFunctions();
		const notificationFunctions = yield* makeNotificationSandboxApiFunctions();

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

		const createEvents = (
			input: UserSandboxRunInput,
			payload: ReadonlyArray<CreateEventItem>,
			effectKey?: string,
		) => {
			const automation = input.executionKind === "subscription" ? input.automationRun : undefined;
			if (payload.length === 0) {
				return Effect.succeed({ count: 0 });
			}
			if (!automation) {
				const executionId = `${input.executionId}-create-events-${hashPayload(payload)}`;
				return events.create({
					payload,
					executionId,
					source: "sandbox",
					userId: UserId.make(input.userId),
				});
			}
			return Effect.gen(function* () {
				if (!effectKey?.trim()) {
					return yield* Effect.fail("createEvents requires an effect key in subscriptions");
				}
				if (automation.automationDepth >= 8) {
					return yield* Effect.fail("Automation depth limit exceeded");
				}
				const reservation = yield* reserveAutomationEffect({
					effectKey,
					automations,
					runId: automation.runId,
					validatedInput: payload,
					mapError: unknownToMessage,
					hostFunction: "createEvents",
					correlationUnits: payload.length,
					correlationId: automation.correlationId,
					missingEffectKeyMessage: "createEvents requires an effect key in subscriptions",
				});
				if (reservation.kind === "existing") {
					return reservation.result;
				}
				const executionId = `${input.executionId}-create-events-${reservation.effectId}`;
				const result = yield* events.create({
					payload,
					executionId,
					source: "sandbox",
					userId: UserId.make(input.userId),
					metadata: {
						correlationId: automation.correlationId,
						automationDepth: automation.automationDepth,
					},
				});
				yield* finishAutomationEffect({
					result,
					automations,
					mapError: unknownToMessage,
					effectId: reservation.effectId,
					downstreamExecutionId: executionId,
				});
				return result;
			});
		};

		return {
			...cacheFunctions,
			...notificationFunctions,
			createEvents: (...args) => {
				const body = args[0];
				const effectKey = typeof args[1] === "string" ? args[1] : undefined;
				const input = requireUserSandboxRunInput(args, effectKey ? 2 : 1, "createEvents");
				return runHostEffect(
					runPromise,
					decodeCreateEventsPayload(body).pipe(
						Effect.flatMap((payload) => createEvents(input, payload, effectKey)),
					),
				);
			},
			emitSignal: (...args) => {
				const body = args[0];
				const input = requireSandboxRunInput(args, 1, "emitSignal");
				return runHostEffect(
					runPromise,
					decodeEmitSignalPayload(body).pipe(
						Effect.flatMap((payload) =>
							Effect.gen(function* () {
								if (input.executionKind !== "subscription" || !input.automationRun) {
									return yield* Effect.fail("emitSignal requires subscription execution");
								}
								if (input.automationRun.automationDepth >= 8) {
									return yield* Effect.fail("Automation depth limit exceeded");
								}
								const reservation = yield* reserveAutomationEffect({
									automations,
									correlationUnits: 1,
									validatedInput: payload,
									hostFunction: "emitSignal",
									mapError: unknownToMessage,
									effectKey: payload.effectKey,
									runId: input.automationRun.runId,
									correlationId: input.automationRun.correlationId,
									missingEffectKeyMessage: "emitSignal requires an effect key in subscriptions",
								});
								if (reservation.kind === "existing") {
									return reservation.result;
								}
								const occurredAt = input.automationRun.occurrenceAt
									? DateTime.toDate(input.automationRun.occurrenceAt)
									: yield* DateTime.nowAsDate;
								const emitted = yield* emitAndDispatchSignal(engine, {
									occurredAt,
									trusted: input.scriptIsBuiltin,
									properties: payload.properties,
									causationId: input.executionId,
									signalSchemaId: payload.signalSchemaId,
									subjectEntityId: payload.subjectEntityId,
									id: SignalId.make(reservation.effectId),
									correlationId: input.automationRun.correlationId,
									automationDepth: input.automationRun.automationDepth,
									origin: { kind: "automation", executionId: input.executionId },
									principal: input.userId
										? { kind: "user", userId: UserId.make(input.userId) }
										: { kind: "system" },
								}).pipe(
									Effect.provideService(AutomationsService, automations),
									Effect.provideService(AutomationsRepository, automationsRepository),
									Effect.provideService(DbRunner, runWithDb),
								);
								const result = { signalId: emitted.signal.id, duplicate: emitted.duplicate };
								yield* finishAutomationEffect({
									result,
									automations,
									mapError: unknownToMessage,
									effectId: reservation.effectId,
								});
								return result;
							}),
						),
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
