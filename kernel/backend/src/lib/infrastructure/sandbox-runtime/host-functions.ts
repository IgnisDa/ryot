import { PgClient } from "@effect/sql-pg";
import { unknownToMessage } from "@ryot-app/contract/errors";
import {
	CreateEventItem,
	type CreateEventsResponse,
} from "@ryot-app/contract/modules/events/schemas";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { SandboxHostCapability } from "@ryot-app/contract/modules/sandbox/wire";
import {
	EntityId,
	EntitySchemaSlug,
	IntegrationId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	changeUserRelationshipBatchSchema,
	upsertGlobalEntitiesOptionsSchema,
	upsertGlobalEntityItemSchema,
	upsertGlobalRelationshipGroupSchema,
} from "@ryot-app/sandbox-sdk/core";
import { jsonValueSchema, type SandboxHostError } from "@ryot-app/sandbox-sdk/wire";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import {
	runLifecycleWriteInline,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import { getPluginConfig, getSystemConfig } from "#lib/infrastructure/sandbox-runtime/app-config";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import {
	type AdditionalSandboxHostImplementationMap,
	isJsonValue,
	requireSandboxCapabilityInput,
	reportSandboxLifecycleWarnings,
	sandboxLifecycleCommand,
	sandboxRunIntegrationId,
	sandboxRunUserId,
	sandboxHostEffect,
	toSandboxHostError,
	toSandboxJsonValue,
	userSandboxRunUserId,
	type SandboxRunInput,
	type UserSandboxRunInput,
} from "#lib/infrastructure/sandbox-runtime/shared";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	EntitiesService,
	type GlobalEntityUpsertResults,
	type PendingGlobalEntityUpsert,
} from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { IntegrationsRepository, type IntegrationRecord } from "#modules/integrations/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import {
	applyRelationshipPolicies,
	commitProjectedRelationshipMutations,
	prepareChangeUserBatch,
	prepareReconcileGlobalGroup,
	reconciliationSummary,
	summarizeRelationshipMutations,
	type PendingRelationshipMutations,
	type RelationshipBatchSummary,
	type RelationshipReconciliationSummary,
} from "#modules/relationships/mutation-pipeline";
import { RelationshipsRepository } from "#modules/relationships/repository";
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
	| RelationshipsRepository
	| PgClient.PgClient
	| LifecyclePlanner
	| LifecycleExecution;

const CreateEventsPayload = Schema.Array(CreateEventItem);

export const SandboxLifecycleHostInput = Schema.Union([
	Schema.TaggedStruct("Failure", { message: Schema.String }),
	Schema.TaggedStruct("UpsertGlobalEntities", {
		command: LifecycleCommand,
		providerId: SandboxProviderId,
		items: Schema.Array(upsertGlobalEntityItemSchema),
		options: Schema.NullOr(upsertGlobalEntitiesOptionsSchema),
	}),
	Schema.TaggedStruct("ChangeUserRelationships", {
		userId: UserId,
		command: LifecycleCommand,
		batches: Schema.Array(changeUserRelationshipBatchSchema),
	}),
	Schema.TaggedStruct("UpsertGlobalRelationships", {
		command: LifecycleCommand,
		groups: Schema.Array(upsertGlobalRelationshipGroupSchema),
	}),
]);
export type SandboxLifecycleHostInput = typeof SandboxLifecycleHostInput.Type;
type LifecycleHostInput<Tag extends SandboxLifecycleHostInput["_tag"]> = Extract<
	SandboxLifecycleHostInput,
	{ readonly _tag: Tag }
>;

export class SandboxLifecycleHostFailure extends Schema.TaggedError<SandboxLifecycleHostFailure>()(
	"SandboxLifecycleHostFailure",
	{ message: Schema.String, data: Schema.optional(jsonValueSchema) },
) {}

const lifecycleHostFailure = (error: unknown) => {
	const hostError = toSandboxHostError(error);
	return new SandboxLifecycleHostFailure({
		message: hostError.message,
		...(hostError.data === undefined ? {} : { data: hostError.data }),
	});
};

const decodeRyotQLDocument = Schema.decodeUnknownEffect(Schema.toType(RyotQLDocument));
const decodeCreateEventsPayload = Schema.decodeUnknownEffect(CreateEventsPayload);

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
		: reportSandboxLifecycleWarnings("createEvents", result.warnings).pipe(
				Effect.as({ count: result.count }),
			);

const userLifecycleSource = (input: UserSandboxRunInput) =>
	input.principal.subject.type === "user" && input.principal.subject.integrationId
		? ("integration" as const)
		: ("api" as const);

const hasInvalidPopulatedAt = (item: LifecycleHostInput<"UpsertGlobalEntities">["items"][number]) =>
	item.populatedAt !== null && Number.isNaN(new Date(item.populatedAt).getTime());

const makeSandboxLifecycleHostSteps = (dependencies: {
	readonly entities: EntitiesService["Service"];
	readonly provideEntityServices: <A, E>(
		effect: Effect.Effect<
			A,
			E,
			Database | PgClient.PgClient | LifecyclePlanner | LifecycleExecution
		>,
	) => Effect.Effect<A, E>;
	readonly provideRelationshipServices: <A, E>(
		effect: Effect.Effect<
			A,
			E,
			| Database
			| DefinitionRegistry
			| EntitiesRepository
			| PluginRuntimeResolver
			| RelationshipsRepository
			| PgClient.PgClient
			| LifecyclePlanner
			| LifecycleExecution
		>,
	) => Effect.Effect<A, E>;
}) => {
	const { entities, provideEntityServices, provideRelationshipServices } = dependencies;
	const applyRelationshipHostPolicies = (pending: PendingRelationshipMutations) =>
		provideRelationshipServices(
			applyRelationshipPolicies(pending).pipe(Effect.mapError(lifecycleHostFailure)),
		);
	const upsertGlobalEntitiesStep = (
		input: LifecycleHostInput<"UpsertGlobalEntities">,
		cursor: Parameters<EntitiesService["Service"]["prepareUpsertGlobalEntitiesStep"]>[4],
	) =>
		provideEntityServices(
			entities
				.prepareUpsertGlobalEntitiesStep(
					input.items.map((item) => ({
						name: item.name,
						externalId: item.externalId,
						properties: item.properties,
						entitySchemaSlug: EntitySchemaSlug.make(item.entitySchemaSlug),
						populatedAt: item.populatedAt === null ? null : new Date(item.populatedAt),
					})),
					input.providerId,
					input.command,
					input.options?.maximumTotal === undefined
						? undefined
						: { maximumTotal: input.options.maximumTotal },
					cursor,
				)
				.pipe(Effect.mapError(lifecycleHostFailure)),
		);
	return {
		upsertGlobalEntities: {
			prepare: upsertGlobalEntitiesStep,
			applyPolicies: (pending: PendingGlobalEntityUpsert) =>
				provideEntityServices(
					entities.applyGlobalEntityPolicies(pending).pipe(Effect.mapError(lifecycleHostFailure)),
				),
			commit: (
				input: LifecycleHostInput<"UpsertGlobalEntities">,
				pending: PendingGlobalEntityUpsert,
			) => upsertGlobalEntitiesStep(input, { planned: pending.planned, accepted: pending.pending }),
			value: (results: GlobalEntityUpsertResults) =>
				results.map((result) =>
					result.status === "skipped"
						? { status: result.status }
						: { status: result.status, entityId: result.entityId, wasInserted: result.wasInserted },
				),
			validate: (
				rawInput: SandboxRunInput,
				items: LifecycleHostInput<"UpsertGlobalEntities">["items"],
				options: LifecycleHostInput<"UpsertGlobalEntities">["options"] | undefined,
			): Effect.Effect<LifecycleHostInput<"UpsertGlobalEntities">, SandboxHostError> =>
				sandboxHostEffect(
					Effect.gen(function* () {
						const input = yield* requireSandboxCapabilityInput(rawInput, "upsertGlobalEntities");
						if (items.length > SANDBOX_LIMITS.globalWrites.entityItems) {
							return yield* Effect.fail(
								`upsertGlobalEntities exceeds ${SANDBOX_LIMITS.globalWrites.entityItems} items`,
							);
						}
						if (items.some(hasInvalidPopulatedAt)) {
							return yield* Effect.fail(
								"upsertGlobalEntities populatedAt must be a valid date string",
							);
						}
						const command = yield* sandboxLifecycleCommand(
							input,
							"provider-refresh",
							"upsertGlobalEntities",
						);
						return {
							items,
							command,
							options: options ?? null,
							_tag: "UpsertGlobalEntities",
							providerId: input.principal.providerId,
						} as const;
					}),
				),
		},
		changeUserRelationships: {
			applyPolicies: applyRelationshipHostPolicies,
			value: (results: ReadonlyArray<RelationshipBatchSummary>) =>
				results.map(({ created, deleted }) => ({ created, deleted })),
			commit: (pending: PendingRelationshipMutations) =>
				provideRelationshipServices(
					commitProjectedRelationshipMutations(pending, summarizeRelationshipMutations).pipe(
						Effect.mapError(lifecycleHostFailure),
					),
				),
			prepare: (
				input: LifecycleHostInput<"ChangeUserRelationships">,
				batch: LifecycleHostInput<"ChangeUserRelationships">["batches"][number],
				index: number,
			) =>
				provideRelationshipServices(
					prepareChangeUserBatch(
						input.userId,
						{
							creates: batch.creates.map(toSandboxRelationshipIdentity),
							deletes: batch.deletes.map(toSandboxRelationshipIdentity),
						},
						index,
						input.command,
					).pipe(Effect.mapError(lifecycleHostFailure)),
				),
			validate: (
				rawInput: SandboxRunInput,
				batches: LifecycleHostInput<"ChangeUserRelationships">["batches"],
			): Effect.Effect<LifecycleHostInput<"ChangeUserRelationships">, SandboxHostError> =>
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
						const command = yield* sandboxLifecycleCommand(
							input,
							userLifecycleSource(input),
							"changeUserRelationships",
						);
						return {
							batches,
							command,
							_tag: "ChangeUserRelationships",
							userId: UserId.make(userSandboxRunUserId(input)),
						} as const;
					}),
				),
		},
		upsertGlobalRelationships: {
			applyPolicies: applyRelationshipHostPolicies,
			value: (results: ReadonlyArray<RelationshipReconciliationSummary>) =>
				results.map(({ deleted, upserted }) => ({ deleted, upserted })),
			commit: (
				group: LifecycleHostInput<"UpsertGlobalRelationships">["groups"][number],
				pending: PendingRelationshipMutations,
			) =>
				provideRelationshipServices(
					commitProjectedRelationshipMutations(
						pending,
						reconciliationSummary(group.relationships.length),
					).pipe(Effect.mapError(lifecycleHostFailure)),
				),
			prepare: (
				input: LifecycleHostInput<"UpsertGlobalRelationships">,
				group: LifecycleHostInput<"UpsertGlobalRelationships">["groups"][number],
				index: number,
			) =>
				provideRelationshipServices(
					prepareReconcileGlobalGroup(toReconcileGroup(group), index, input.command).pipe(
						Effect.mapError(lifecycleHostFailure),
					),
				),
			validate: (
				rawInput: SandboxRunInput,
				groups: LifecycleHostInput<"UpsertGlobalRelationships">["groups"],
			): Effect.Effect<LifecycleHostInput<"UpsertGlobalRelationships">, SandboxHostError> =>
				sandboxHostEffect(
					Effect.gen(function* () {
						const input = yield* requireSandboxCapabilityInput(
							rawInput,
							"upsertGlobalRelationships",
						);
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
						const command = yield* sandboxLifecycleCommand(
							input,
							"provider-refresh",
							"upsertGlobalRelationships",
						);
						return { groups, command, _tag: "UpsertGlobalRelationships" } as const;
					}),
				),
		},
	};
};

export type SandboxLifecycleHostSteps = ReturnType<typeof makeSandboxLifecycleHostSteps>;

export const makeSandboxLifecycleHostApi = Effect.gen(function* () {
	const database = yield* Database;
	const pgClient = yield* PgClient.PgClient;
	const lifecyclePlanner = yield* LifecyclePlanner;
	const lifecycleExecution = yield* LifecycleExecution;
	const entities = yield* EntitiesService;
	const definitions = yield* DefinitionRegistry;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const entitiesRepository = yield* EntitiesRepository;
	const relationshipsRepository = yield* RelationshipsRepository;
	const provideLifecycleServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		effect.pipe(
			Effect.provideService(Database, database),
			Effect.provideService(PgClient.PgClient, pgClient),
			Effect.provideService(LifecyclePlanner, lifecyclePlanner),
			Effect.provideService(LifecycleExecution, lifecycleExecution),
		);
	return makeSandboxLifecycleHostSteps({
		entities,
		provideEntityServices: provideLifecycleServices,
		provideRelationshipServices: (effect) =>
			effect.pipe(
				Effect.provideService(DefinitionRegistry, definitions),
				Effect.provideService(EntitiesRepository, entitiesRepository),
				Effect.provideService(PluginRuntimeResolver, pluginRuntime),
				Effect.provideService(RelationshipsRepository, relationshipsRepository),
				provideLifecycleServices,
			),
	});
});

const toReconcileGroup = (
	group: LifecycleHostInput<"UpsertGlobalRelationships">["groups"][number],
) => ({
	relationships: group.relationships.map(toSandboxRelationshipIdentity),
	relationshipSchemaSlug: RelationshipSchemaSlug.make(group.relationshipSchemaSlug),
	selector:
		group.selector.type === "self"
			? group.selector
			: { ...group.selector, anchorEntityId: EntityId.make(group.selector.anchorEntityId) },
});

export const makeAdditionalSandboxApiFunctions: Effect.Effect<
	AdditionalSandboxHostImplementationMap,
	never,
	SandboxHostFunctionContext
> = Effect.gen(function* () {
	const database = yield* Database;
	const pgClient = yield* PgClient.PgClient;
	const lifecyclePlanner = yield* LifecyclePlanner;
	const lifecycleExecution = yield* LifecycleExecution;
	const events = yield* EventsService;
	const entities = yield* EntitiesService;
	const ryotqlService = yield* RyotQLService;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const integrationsRepository = yield* IntegrationsRepository;
	const provideLifecycleServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		effect.pipe(
			Effect.provideService(PgClient.PgClient, pgClient),
			Effect.provideService(LifecyclePlanner, lifecyclePlanner),
			Effect.provideService(LifecycleExecution, lifecycleExecution),
		);

	const lifecycle = yield* makeSandboxLifecycleHostApi;
	const writeInlineLifecycleItems = Effect.fnUntraced(function* <Item, Result>(options: {
		readonly items: ReadonlyArray<Item>;
		readonly capability: SandboxHostCapability;
		readonly applyPolicies: (
			pending: PendingRelationshipMutations,
		) => Effect.Effect<PendingRelationshipMutations, SandboxLifecycleHostFailure>;
		readonly prepare: (
			item: Item,
			index: number,
		) => Effect.Effect<
			LifecyclePreparedStep<Result, PendingRelationshipMutations>,
			SandboxLifecycleHostFailure
		>;
		readonly commit: (
			item: Item,
		) => (
			pending: PendingRelationshipMutations,
		) => Effect.Effect<
			LifecyclePreparedStep<Result, PendingRelationshipMutations>,
			SandboxLifecycleHostFailure
		>;
	}) {
		const warnings = [];
		const results = [];
		for (const [index, item] of options.items.entries()) {
			const written = yield* runLifecycleWriteInline(lifecycleExecution, {
				commit: options.commit(item),
				applyPolicies: options.applyPolicies,
				prepare: options.prepare(item, index),
			});
			warnings.push(...written.warnings);
			results.push(written.result);
		}
		yield* reportSandboxLifecycleWarnings(options.capability, warnings);
		return results;
	});

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
		Effect.gen(function* () {
			if (payload.length === 0) {
				return { count: 0 };
			}
			const command = yield* sandboxLifecycleCommand(
				input,
				userLifecycleSource(input),
				"createEvents",
			);
			return yield* events
				.create({ payload, userId: UserId.make(userSandboxRunUserId(input)) }, command)
				.pipe(provideLifecycleServices, Effect.flatMap(toSandboxCreateEventsResult));
		});

	return {
		getUserPreferences: (rawInput) =>
			requireSandboxCapabilityInput(rawInput, "getUserPreferences").pipe(
				Effect.flatMap((input) => readUserPreferences(UserId.make(userSandboxRunUserId(input)))),
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
		changeUserRelationships: (rawInput, batches) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* lifecycle.changeUserRelationships.validate(rawInput, batches);
					const results = yield* writeInlineLifecycleItems({
						items: input.batches,
						capability: "changeUserRelationships",
						commit: () => lifecycle.changeUserRelationships.commit,
						applyPolicies: lifecycle.changeUserRelationships.applyPolicies,
						prepare: (batch, index) =>
							lifecycle.changeUserRelationships.prepare(input, batch, index),
					});
					return lifecycle.changeUserRelationships.value(results);
				}),
			),
		listIntegrations: (rawInput, rawOptions) =>
			Effect.gen(function* () {
				const input = yield* requireSandboxCapabilityInput(rawInput, "listIntegrations");
				const options = rawOptions ?? {};

				return yield* sandboxHostEffect(
					integrationsRepository
						.listForUser({
							userId: UserId.make(userSandboxRunUserId(input)),
							...(options.provider !== undefined ? { provider: options.provider } : {}),
							...(options.isDisabled !== undefined ? { isDisabled: options.isDisabled } : {}),
						})
						.pipe(
							Effect.map((rows) => rows.map(toSandboxIntegration)),
							Effect.provideService(Database, database),
						),
				);
			}),
		upsertGlobalEntities: (rawInput, items, options) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* lifecycle.upsertGlobalEntities.validate(rawInput, items, options);
					const { result, warnings } = yield* runLifecycleWriteInline(lifecycleExecution, {
						applyPolicies: lifecycle.upsertGlobalEntities.applyPolicies,
						commit: (pending) => lifecycle.upsertGlobalEntities.commit(input, pending),
						prepare: lifecycle.upsertGlobalEntities.prepare(input, { planned: [], accepted: null }),
					});
					yield* reportSandboxLifecycleWarnings("upsertGlobalEntities", warnings);
					return lifecycle.upsertGlobalEntities.value(result);
				}),
			),
		upsertGlobalRelationships: (rawInput, groups) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* lifecycle.upsertGlobalRelationships.validate(rawInput, groups);
					const results = yield* writeInlineLifecycleItems({
						items: input.groups,
						capability: "upsertGlobalRelationships",
						applyPolicies: lifecycle.upsertGlobalRelationships.applyPolicies,
						commit: (group) => (pending) =>
							lifecycle.upsertGlobalRelationships.commit(group, pending),
						prepare: (group, index) =>
							lifecycle.upsertGlobalRelationships.prepare(input, group, index),
					});
					return lifecycle.upsertGlobalRelationships.value(results);
				}),
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

					return integrationsRepository
						.getForUser({
							integrationId: IntegrationId.make(integrationId),
							userId: UserId.make(userSandboxRunUserId(input)),
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
		getPluginConfig: (input, rawKeys) =>
			sandboxHostEffect(
				normalizeConfigKeys("getPluginConfig", rawKeys).pipe(
					Effect.flatMap((keys) => {
						const revision = input.principal.pluginRevision;
						if (!revision) {
							return Effect.fail("Plugin config is available only to active plugin scripts");
						}
						return pluginRuntime
							.resolvePluginConfigContext({
								id: revision.configRevisionId,
								ownerUserId: revision.ownerId,
								pluginRevisionId: revision.revisionId,
							})
							.pipe(
								Effect.flatMap((config) =>
									getPluginConfig({
										keys,
										metadata: input.principal.metadata,
										context: { config, kind: "installation", configSchema: revision.configSchema },
									}),
								),
								Effect.flatMap((values) => encodeConfigValues("Plugin", values)),
							);
					}),
					Effect.provideService(Database, database),
				),
			),
		executeRyotql: (rawInput, query) =>
			requireSandboxCapabilityInput(rawInput, "executeRyotql").pipe(
				Effect.flatMap((input) => {
					const { subject } = input.principal;
					if (
						subject.type === "system" ||
						(subject.type === "automation-run" && subject.executionUserId === null)
					) {
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
						Effect.gen(function* () {
							const document = yield* decodeRyotQLDocument(query);
							const userId = sandboxRunUserId(input);
							if (userId === null) {
								return yield* Effect.fail("executeRyotql requires a user execution");
							}
							return yield* ryotqlService.executeForUser(userId, null, document);
						}),
					);
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
								.getEffectiveDefinitions(UserId.make(userSandboxRunUserId(input)))
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
		ensureUserEntities: (rawInput, items) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "ensureUserEntities");
					const revision = input.principal.pluginRevision;
					const userId = UserId.make(userSandboxRunUserId(input));
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
					const command = yield* sandboxLifecycleCommand(input, "bootstrap", "ensureUserEntities");
					const results = yield* entities
						.ensureUserEntities(
							userId,
							items.map((item) => ({
								...item,
								entitySchemaSlug: EntitySchemaSlug.make(item.entitySchemaSlug),
							})),
							command,
						)
						.pipe(Effect.provideService(Database, database), provideLifecycleServices);
					yield* reportSandboxLifecycleWarnings(
						"ensureUserEntities",
						results.flatMap((result) => result.warnings),
					);
					return results.map(({ entityId, wasInserted }) => ({ entityId, wasInserted }));
				}).pipe(Effect.provideService(Database, database)),
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
								.getEffectiveDefinitions(UserId.make(userSandboxRunUserId(input)))
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
												userId: userSandboxRunUserId(input),
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
