import { unknownToMessage } from "@ryot-app/contract/errors";
import {
	CreateEventItem,
	type CreateEventsResponse,
} from "@ryot-app/contract/modules/events/schemas";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityId,
	EntitySchemaSlug,
	IntegrationId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
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
	| Database
	| RyotQLService
	| EventsService
	| EntitiesService
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
	const {
		pluginSlug: _pluginSlug,
		pluginInstallationId: _pluginInstallationId,
		...record
	} = integration;
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
		allowNsfw: source["allowNsfw"] === true,
		disableIntegrations: source["disableIntegrations"] === true,
	};
};

export const toSandboxCreateEventsResult = (result: CreateEventsResponse) =>
	result.failure
		? Effect.fail(`Event creation failed: ${result.failure.reason.code}`)
		: Effect.succeed({ count: result.count });

export const makeAdditionalSandboxApiFunctions: Effect.Effect<
	AdditionalSandboxHostImplementationMap,
	never,
	SandboxHostFunctionContext
> = Effect.gen(function* () {
	const database = yield* Database;
	const events = yield* EventsService;
	const entities = yield* EntitiesService;
	const ryotqlService = yield* RyotQLService;
	const definitions = yield* DefinitionRegistry;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const entitiesRepository = yield* EntitiesRepository;
	const integrationsRepository = yield* IntegrationsRepository;
	const relationshipsRepository = yield* RelationshipsRepository;

	const readUserPreferences = (userId: UserId) =>
		Effect.gen(function* () {
			const [row] = yield* mapDatabaseErrors(
				database
					.select({ preferences: schema.user.preferences })
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			if (!row) {
				return yield* Effect.fail("User not found");
			}

			return normalizePreferences(row.preferences);
		});

	const createEvents = (input: UserSandboxRunInput, payload: ReadonlyArray<CreateEventItem>) =>
		payload.length === 0
			? Effect.succeed({ count: 0 })
			: events
					.create({
						payload,
						source: "sandbox",
						userId: UserId.make(input.principal.subject.userId),
						executionId: `${input.executionId}-create-events-${hashPayload(payload)}`,
					})
					.pipe(Effect.flatMap(toSandboxCreateEventsResult));

	return {
		getUserPreferences: (rawInput) =>
			requireSandboxCapabilityInput(rawInput, "getUserPreferences").pipe(
				Effect.flatMap((input) => readUserPreferences(UserId.make(input.principal.subject.userId))),
				sandboxHostEffect,
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
		getSystemConfig: (input, rawKeys) =>
			sandboxHostEffect(
				normalizeConfigKeys("getSystemConfig", rawKeys).pipe(
					Effect.flatMap((keys) =>
						getSystemConfig(keys, input.principal.metadata).pipe(
							Effect.flatMap((values) => encodeConfigValues("System", values)),
						),
					),
				),
			),
		getPluginConfig: (input, rawKeys) =>
			sandboxHostEffect(
				normalizeConfigKeys("getPluginConfig", rawKeys).pipe(
					Effect.flatMap((keys) =>
						pluginRuntime.resolvePluginConfigContext(input.principal).pipe(
							Effect.flatMap((context) =>
								context
									? getPluginConfig({ keys, context, metadata: input.principal.metadata })
									: Effect.fail("Plugin config is available only to active plugin scripts"),
							),
							Effect.flatMap((values) => encodeConfigValues("Plugin", values)),
						),
					),
					Effect.provideService(Database, database),
				),
			),
		listIntegrations: (rawInput, rawOptions) =>
			Effect.gen(function* () {
				const input = yield* requireSandboxCapabilityInput(rawInput, "listIntegrations");
				const options = rawOptions ?? {};

				return yield* sandboxHostEffect(
					integrationsRepository
						.listForUser({
							userId: UserId.make(input.principal.subject.userId),
							...(options.provider !== undefined ? { provider: options.provider } : {}),
							...(options.isDisabled !== undefined ? { isDisabled: options.isDisabled } : {}),
						})
						.pipe(
							Effect.map((rows) => rows.map(toSandboxIntegration)),
							Effect.provideService(Database, database),
						),
				);
			}),
		getCurrentIntegration: (rawInput) =>
			requireSandboxCapabilityInput(rawInput, "getCurrentIntegration").pipe(
				Effect.flatMap((input) => {
					const integrationId = sandboxRunIntegrationId(input);
					if (!integrationId) {
						return Effect.fail(
							"getCurrentIntegration is available only to executions scoped to an integration",
						);
					}

					return integrationsRepository
						.getForUser({
							integrationId: IntegrationId.make(integrationId),
							userId: UserId.make(input.principal.subject.userId),
						})
						.pipe(
							Effect.flatMap((integration) =>
								integration
									? Effect.succeed(toSandboxIntegration(integration))
									: Effect.fail("Integration not found"),
							),
						);
				}),
				Effect.provideService(Database, database),
				sandboxHostEffect,
			),
		executeRyotql: (rawInput, query) =>
			requireSandboxCapabilityInput(rawInput, "executeRyotql").pipe(
				Effect.flatMap((input) => {
					const { subject } = input.principal;
					if (subject.type === "system") {
						return sandboxHostEffect(
							Effect.gen(function* () {
								const revision = input.principal.pluginRevision;
								if (revision?.scope !== "system") {
									return yield* Effect.fail(
										"executeRyotql system access requires a pinned plugin script",
									);
								}
								const document = yield* decodeRyotQLDocument(query);
								return yield* ryotqlService.executeForPlugin(
									{ pluginSlug: revision.slug, ...revision.schemaScope },
									document,
								);
							}),
						);
					}
					return sandboxHostEffect(
						decodeRyotQLDocument(query).pipe(
							Effect.flatMap((document) =>
								ryotqlService.executeForUser(subject.userId, null, document),
							),
						),
					);
				}),
			),
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
						UserId.make(input.principal.subject.userId),
						batches.map((batch) => ({
							creates: batch.creates.map(toSandboxRelationshipIdentity),
							deletes: batch.deletes.map(toSandboxRelationshipIdentity),
						})),
					).pipe(
						Effect.provideService(Database, database),
						Effect.provideService(DefinitionRegistry, definitions),
						Effect.provideService(EntitiesRepository, entitiesRepository),
						Effect.provideService(PluginRuntimeResolver, pluginRuntime),
						Effect.provideService(RelationshipsRepository, relationshipsRepository),
					);
				}).pipe(Effect.provideService(Database, database)),
			),
		ensureUserEntities: (rawInput, items) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "ensureUserEntities");
					const revision = input.principal.pluginRevision;
					const userId = UserId.make(input.principal.subject.userId);
					const effectiveDefinitions = yield* pluginRuntime.getEffectiveDefinitions(userId);
					for (const item of items) {
						const definition = effectiveDefinitions.entitySchemas[item.entitySchemaSlug];
						if (
							!revision?.schemaScope.entitySchemaSlugs.includes(item.entitySchemaSlug) ||
							!definition ||
							definition.pluginId !== revision.id
						) {
							return yield* Effect.fail(
								`ensureUserEntities cannot write foreign entity schema: ${item.entitySchemaSlug}`,
							);
						}
					}
					return yield* entities
						.ensureUserEntities(
							userId,
							items.map((item) => ({
								...item,
								entitySchemaSlug: EntitySchemaSlug.make(item.entitySchemaSlug),
							})),
							input.workflowExecutionId && input.startedAt
								? { occurredAt: input.startedAt, executionId: input.executionId }
								: undefined,
						)
						.pipe(Effect.provideService(Database, database));
				}).pipe(Effect.provideService(Database, database)),
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
							input.principal.providerId,
							options?.maximumTotal === undefined
								? undefined
								: { maximumTotal: options.maximumTotal },
						)
						.pipe(Effect.provideService(Database, database));
				}),
			),
		listEventSchemas: (rawInput, entitySchemaSlugs) =>
			requireSandboxCapabilityInput(rawInput, "listEventSchemas").pipe(
				Effect.flatMap((input) =>
					requireUniqueNonEmptyStrings(
						entitySchemaSlugs,
						"listEventSchemas expects non-empty entitySchemaSlugs",
					).pipe(
						Effect.flatMap((resolvedEntitySchemaSlugs) => {
							if (resolvedEntitySchemaSlugs.length === 0) {
								return Effect.succeed([]);
							}

							return pluginRuntime
								.getEffectiveDefinitions(UserId.make(input.principal.subject.userId))
								.pipe(
									Effect.flatMap((effectiveDefinitions) =>
										Effect.forEach(resolvedEntitySchemaSlugs, (entitySchemaSlug) => {
											const entitySchema = effectiveDefinitions.entitySchemas[entitySchemaSlug];
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
										}).pipe(Effect.map((schemas) => schemas.flat())),
									),
								);
						}),
					),
				),
				Effect.provideService(Database, database),
				sandboxHostEffect,
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
							relationships: group.relationships.map(toSandboxRelationshipIdentity),
							relationshipSchemaSlug: RelationshipSchemaSlug.make(group.relationshipSchemaSlug),
							selector:
								group.selector.type === "self"
									? group.selector
									: {
											...group.selector,
											anchorEntityId: EntityId.make(group.selector.anchorEntityId),
										},
						})),
					).pipe(
						Effect.provideService(Database, database),
						Effect.provideService(DefinitionRegistry, definitions),
						Effect.provideService(RelationshipsRepository, relationshipsRepository),
					);
				}),
			),
		getEntitySchemas: (rawInput, entitySchemaSlugs) =>
			requireSandboxCapabilityInput(rawInput, "getEntitySchemas").pipe(
				Effect.flatMap((input) =>
					requireUniqueNonEmptyStrings(
						entitySchemaSlugs,
						"getEntitySchemas expects non-empty entitySchemaSlugs",
					).pipe(
						Effect.flatMap((resolvedEntitySchemaSlugs) => {
							if (resolvedEntitySchemaSlugs.length === 0) {
								return Effect.succeed([]);
							}

							return pluginRuntime
								.getEffectiveDefinitions(UserId.make(input.principal.subject.userId))
								.pipe(
									Effect.flatMap((effectiveDefinitions) =>
										Effect.forEach(resolvedEntitySchemaSlugs, (entitySchemaSlug) => {
											const definition = effectiveDefinitions.entitySchemas[entitySchemaSlug];
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
										}),
									),
									Effect.flatMap((schemas) =>
										Effect.gen(function* () {
											const links = yield* pluginRuntime.listSchemaProviders({
												userId: input.principal.subject.userId,
												entitySchemaSlugs: resolvedEntitySchemaSlugs,
											});
											const providersBySchema = new Map<
												string,
												Array<{ name: string; providerId: string }>
											>();
											for (const { provider, entitySchemaSlug } of links) {
												const providers = providersBySchema.get(entitySchemaSlug) ?? [];
												providers.push({ name: provider.name, providerId: provider.id });
												providersBySchema.set(entitySchemaSlug, providers);
											}

											return schemas.map(({ definition, pluginSlug, entitySchemaSlug }) => ({
												pluginSlug,
												isBuiltin: true,
												id: entitySchemaSlug,
												icon: definition.icon,
												name: definition.name,
												slug: definition.slug,
												providers: providersBySchema.get(entitySchemaSlug) ?? [],
												propertiesSchema: toSandboxJsonValue(definition.propertiesSchema),
											}));
										}).pipe(Effect.mapError(unknownToMessage)),
									),
								);
						}),
					),
				),
				Effect.provideService(Database, database),
				sandboxHostEffect,
			),
	} satisfies AdditionalSandboxHostImplementationMap;
});
