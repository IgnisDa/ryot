import { unknownToMessage } from "@ryot-app/contract/errors";
import {
	CreateEventItem,
	UpdateEventItem,
	type CreateEventsResponse,
} from "@ryot-app/contract/modules/events/schemas";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { SandboxHostCapability } from "@ryot-app/contract/modules/sandbox/wire";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	type ImportRunId,
	IntegrationId,
	OAuthConnectionId,
	PluginId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { isJsonValue } from "@ryot-app/contract/schema/json";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	EVENT_MUTATION_SANDBOX_LIMITS,
	changeUserRelationshipBatchSchema,
	createUserEntityArgsSchema,
	deleteEventsArgsSchema,
	upsertGlobalEntitiesOptionsSchema,
	upsertGlobalEntityItemSchema,
	upsertGlobalRelationshipGroupSchema,
	updateEventsArgsSchema,
} from "@ryot-app/sandbox-sdk/core";
import { jsonValueSchema, type SandboxHostError } from "@ryot-app/sandbox-sdk/wire";
import type { WorkflowDurableCallRequest } from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";

import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import {
	runLifecycleWriteInline,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import { getPluginConfig } from "#lib/infrastructure/sandbox-runtime/app-config";
import { isDeclaredExecutableCall } from "#lib/infrastructure/sandbox-runtime/executable-dependencies";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import {
	type AdditionalSandboxHostImplementationMap,
	requireSandboxCapabilityInput,
	reportSandboxLifecycleWarnings,
	sandboxLifecycleCommand,
	sandboxHostFailure,
	sandboxRunIntegrationId,
	sandboxRunUserId,
	sandboxDefinitionReadContext,
	sandboxHostEffect,
	toSandboxHostError,
	toSandboxJsonValue,
	userSandboxRunUserId,
	type SandboxRunInput,
	type UserSandboxRunInput,
} from "#lib/infrastructure/sandbox-runtime/shared";
import { AuthRepository } from "#modules/auth/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import {
	EntitiesService,
	type GlobalEntityUpsertResults,
	type PendingGlobalEntityUpsert,
} from "#modules/entities/service";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { EventsService } from "#modules/events/service";
import { EventStreamWorkService } from "#modules/events/stream-work";
import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { IntegrationsRepository, type IntegrationRecord } from "#modules/integrations/repository";
import { OAuthConnectionsService } from "#modules/oauth-connections/service";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { resolveStoredPluginUserSettings } from "#modules/plugins/user-settings";
import {
	reconciliationSummary,
	RelationshipMutationPipeline,
	summarizeRelationshipMutations,
	type PendingRelationshipMutations,
	RelationshipBatchSummary,
	RelationshipReconciliationSummary,
} from "#modules/relationships/mutation-pipeline";
import { RyotQLService } from "#modules/ryotql/service";
import { SandboxRepository } from "#modules/sandbox/repository";

type SandboxHostFunctionContext =
	| AuthRepository
	| RyotQLService
	| EventsService
	| EventStreamWorkService
	| SandboxRepository
	| EntitiesService
	| DefinitionRepository
	| PluginRuntimeResolver
	| IntegrationsRepository
	| ImportSourceStateStore
	| PluginInstallationRepository
	| OAuthConnectionsService
	| RelationshipMutationPipeline
	| LifecycleExecution;

const CreateEventsPayload = Schema.Array(CreateEventItem);

export const SandboxLifecycleHostInput = Schema.Union([
	Schema.TaggedStruct("Failure", {
		message: Schema.String,
		data: Schema.optional(jsonValueSchema),
	}),
	Schema.TaggedStruct("UpsertGlobalEntities", {
		providerId: SandboxProviderId,
		command: DomainLifecycleCommand,
		items: Schema.Array(upsertGlobalEntityItemSchema),
		options: Schema.NullOr(upsertGlobalEntitiesOptionsSchema),
	}),
	Schema.TaggedStruct("ChangeUserRelationships", {
		userId: UserId,
		command: DomainLifecycleCommand,
		batches: Schema.Array(changeUserRelationshipBatchSchema),
	}),
	Schema.TaggedStruct("UpsertGlobalRelationships", {
		command: DomainLifecycleCommand,
		groups: Schema.Array(upsertGlobalRelationshipGroupSchema),
	}),
	Schema.TaggedStruct("UpdateEvents", {
		userId: UserId,
		command: DomainLifecycleCommand,
		items: Schema.Array(UpdateEventItem),
	}),
	Schema.TaggedStruct("DeleteEvents", {
		userId: UserId,
		command: DomainLifecycleCommand,
		eventIds: Schema.Array(EventId),
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
		readonly relationshipSchemaSlug: string;
	},
>(
	relationship: T,
	pluginId: string | null,
) => {
	const { relationshipSchemaSlug, ...identity } = relationship;
	return {
		...identity,
		sourceEntityId: EntityId.make(relationship.sourceEntityId),
		targetEntityId: EntityId.make(relationship.targetEntityId),
		relationshipSchema: {
			owner: definitionOwner(pluginId),
			slug: RelationshipSchemaSlug.make(relationshipSchemaSlug),
		},
	};
};

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

const admittedImportRunId = (input: UserSandboxRunInput) => {
	const subject = input.principal.subject;
	if (subject.type !== "user") {
		return null;
	}
	return subject.importRunId ?? subject.integrationRunId ?? null;
};

const requireNonEmptyString = (value: string, message: string): Effect.Effect<string, string> => {
	if (value.trim().length === 0) {
		return Effect.fail(message);
	}

	return Effect.succeed(value.trim());
};

const requireUniqueNonEmptyStrings = (values: ReadonlyArray<string>, message: string) =>
	Effect.forEach(values, (value) => requireNonEmptyString(value, message)).pipe(
		Effect.map((strings) => [...new Set(strings)]),
	);

const normalizeConfigKeys = (
	rawKeys: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, string> => {
	const keys = rawKeys.map((key) => key.trim());
	return keys.some((key) => !key)
		? Effect.fail("getPluginConfig expects non-empty key strings")
		: Effect.succeed(keys);
};

const encodeConfigValues = (values: Readonly<Record<string, unknown>>) =>
	Effect.forEach(Object.entries(values), ([key, value]) =>
		isJsonValue(value)
			? Effect.succeed([key, value] as const)
			: Effect.fail(`Plugin config key "${key}" is not JSON-compatible`),
	).pipe(Effect.map((entries): Record<string, JsonValue> => Object.fromEntries(entries)));

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

export type LifecycleItemWrite<Item, Result> = {
	readonly items: ReadonlyArray<Item>;
	readonly result: Schema.Codec<Result, unknown>;
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
};

const makeSandboxLifecycleHostSteps = (dependencies: {
	readonly events: EventsService["Service"];
	readonly entities: EntitiesService["Service"];
	readonly relationships: RelationshipMutationPipeline["Service"];
}) => {
	const { events, entities, relationships } = dependencies;
	const applyRelationshipHostPolicies = (pending: PendingRelationshipMutations) =>
		relationships.applyPolicies(pending).pipe(Effect.mapError(lifecycleHostFailure));
	const upsertGlobalEntitiesStep = (
		input: LifecycleHostInput<"UpsertGlobalEntities">,
		cursor: Parameters<EntitiesService["Service"]["prepareUpsertGlobalEntitiesStep"]>[4],
	) =>
		entities
			.prepareUpsertGlobalEntitiesStep(
				input.items.map((item) => ({
					name: item.name,
					externalId: item.externalId,
					properties: item.properties,
					populatedAt: item.populatedAt === null ? null : new Date(item.populatedAt),
					entitySchema: {
						slug: EntitySchemaSlug.make(item.entitySchemaSlug),
						owner: definitionOwner(input.command.writeContext?.pluginRevision?.id ?? null),
					},
				})),
				input.providerId,
				input.command,
				input.options?.maximumTotal === undefined
					? undefined
					: { maximumTotal: input.options.maximumTotal },
				cursor,
			)
			.pipe(Effect.mapError(lifecycleHostFailure));
	const deleteEvents = {
		commit: (input: LifecycleHostInput<"DeleteEvents">) =>
			events.deleteBatch(input.eventIds, input.userId, input.command).pipe(
				Effect.flatMap(({ count, warnings }) =>
					reportSandboxLifecycleWarnings("deleteEvents", warnings).pipe(Effect.as({ count })),
				),
				Effect.mapError(lifecycleHostFailure),
			),
		validate: (
			rawInput: SandboxRunInput,
			eventIds: ReadonlyArray<string>,
		): Effect.Effect<LifecycleHostInput<"DeleteEvents">, SandboxHostError> =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "deleteEvents");
					if (eventIds.length > EVENT_MUTATION_SANDBOX_LIMITS.items) {
						return yield* Effect.fail(
							`deleteEvents exceeds ${EVENT_MUTATION_SANDBOX_LIMITS.items} items`,
						);
					}
					const decoded = yield* Schema.decodeEffect(Schema.Array(EventId))(eventIds);
					const command = yield* sandboxLifecycleCommand(
						input,
						userLifecycleSource(input),
						"deleteEvents",
					);
					return {
						command,
						eventIds: decoded,
						_tag: "DeleteEvents",
						userId: UserId.make(userSandboxRunUserId(input)),
					} as const;
				}),
			),
	};
	const updateEvents = {
		commit: (input: LifecycleHostInput<"UpdateEvents">) =>
			events.updateBatch(input.items, input.userId, input.command).pipe(
				Effect.flatMap(({ count, warnings }) =>
					reportSandboxLifecycleWarnings("updateEvents", warnings).pipe(Effect.as({ count })),
				),
				Effect.mapError(lifecycleHostFailure),
			),
		validate: (
			rawInput: SandboxRunInput,
			items: ReadonlyArray<unknown>,
		): Effect.Effect<LifecycleHostInput<"UpdateEvents">, SandboxHostError> =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "updateEvents");
					if (items.length > EVENT_MUTATION_SANDBOX_LIMITS.items) {
						return yield* Effect.fail(
							`updateEvents exceeds ${EVENT_MUTATION_SANDBOX_LIMITS.items} items`,
						);
					}
					const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(UpdateEventItem))(items);
					const command = yield* sandboxLifecycleCommand(
						input,
						userLifecycleSource(input),
						"updateEvents",
					);
					return {
						command,
						items: decoded,
						_tag: "UpdateEvents",
						userId: UserId.make(userSandboxRunUserId(input)),
					} as const;
				}),
			),
	};
	return {
		deleteEvents,
		updateEvents,
		upsertGlobalEntities: {
			prepare: upsertGlobalEntitiesStep,
			applyPolicies: (pending: PendingGlobalEntityUpsert) =>
				entities.applyGlobalEntityPolicies(pending).pipe(Effect.mapError(lifecycleHostFailure)),
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
			value: (results: ReadonlyArray<RelationshipBatchSummary>) =>
				results.map(({ created, deleted }) => ({ created, deleted })),
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
			itemWrite: (input: LifecycleHostInput<"ChangeUserRelationships">) => {
				const batches = input.batches.map((entry) => ({
					creates: entry.creates.map((relationship) =>
						toSandboxRelationshipIdentity(
							relationship,
							input.command.writeContext?.pluginRevision?.id ?? null,
						),
					),
					deletes: entry.deletes.map((relationship) =>
						toSandboxRelationshipIdentity(
							relationship,
							input.command.writeContext?.pluginRevision?.id ?? null,
						),
					),
				}));
				return {
					items: batches,
					result: RelationshipBatchSummary,
					applyPolicies: applyRelationshipHostPolicies,
					commit: () => (pending: PendingRelationshipMutations) =>
						relationships
							.commitProjected(pending, summarizeRelationshipMutations)
							.pipe(Effect.mapError(lifecycleHostFailure)),
					prepare: (current: (typeof batches)[number], index: number) =>
						relationships
							.prepareChangeUserBatch(input.userId, current, index, input.command, batches)
							.pipe(Effect.mapError(lifecycleHostFailure)),
				} satisfies LifecycleItemWrite<(typeof batches)[number], RelationshipBatchSummary>;
			},
		},
		upsertGlobalRelationships: {
			value: (results: ReadonlyArray<RelationshipReconciliationSummary>) =>
				results.map(({ deleted, upserted }) => ({ deleted, upserted })),
			itemWrite: (input: LifecycleHostInput<"UpsertGlobalRelationships">) => {
				const groups = input.groups.map((group) => toReconcileGroup(group, input.command));
				return {
					items: input.groups,
					result: RelationshipReconciliationSummary,
					applyPolicies: applyRelationshipHostPolicies,
					commit:
						(group: LifecycleHostInput<"UpsertGlobalRelationships">["groups"][number]) =>
						(pending: PendingRelationshipMutations) =>
							relationships
								.commitProjected(pending, reconciliationSummary(group.relationships.length))
								.pipe(Effect.mapError(lifecycleHostFailure)),
					prepare: (
						group: LifecycleHostInput<"UpsertGlobalRelationships">["groups"][number],
						index: number,
					) =>
						relationships
							.prepareReconcileGlobalGroup(
								toReconcileGroup(group, input.command),
								index,
								input.command,
								groups,
							)
							.pipe(Effect.mapError(lifecycleHostFailure)),
				} satisfies LifecycleItemWrite<
					LifecycleHostInput<"UpsertGlobalRelationships">["groups"][number],
					RelationshipReconciliationSummary
				>;
			},
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
	return makeSandboxLifecycleHostSteps({
		events: yield* EventsService,
		entities: yield* EntitiesService,
		relationships: yield* RelationshipMutationPipeline,
	});
});

const toReconcileGroup = (
	group: LifecycleHostInput<"UpsertGlobalRelationships">["groups"][number],
	command: DomainLifecycleCommand,
) => ({
	selector:
		group.selector.type === "self"
			? group.selector
			: { ...group.selector, anchorEntityId: EntityId.make(group.selector.anchorEntityId) },
	relationshipSchema: {
		slug: RelationshipSchemaSlug.make(group.relationshipSchemaSlug),
		owner: definitionOwner(command.writeContext?.pluginRevision?.id ?? null),
	},
	relationships: group.relationships.map((relationship) => ({
		...relationship,
		sourceEntityId: EntityId.make(relationship.sourceEntityId),
		targetEntityId: EntityId.make(relationship.targetEntityId),
	})),
});

export const makeAdditionalSandboxApiFunctions: Effect.Effect<
	AdditionalSandboxHostImplementationMap,
	never,
	SandboxHostFunctionContext
> = Effect.gen(function* () {
	const auth = yield* AuthRepository;
	const eventStreamWork = yield* EventStreamWorkService;
	const lifecycleExecution = yield* LifecycleExecution;
	const events = yield* EventsService;
	const entities = yield* EntitiesService;
	const ryotqlService = yield* RyotQLService;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const definitions = yield* DefinitionRepository;
	const sandboxRepository = yield* SandboxRepository;
	const integrationsRepository = yield* IntegrationsRepository;
	const sourceStates = yield* ImportSourceStateStore;
	const pluginInstallations = yield* PluginInstallationRepository;
	const oauthConnections = yield* OAuthConnectionsService;
	const lifecycle = yield* makeSandboxLifecycleHostApi;
	const readEntitySchemas = (input: UserSandboxRunInput, slugs: ReadonlyArray<string>) => {
		const userId = UserId.make(userSandboxRunUserId(input));
		const context = sandboxDefinitionReadContext(input);
		return context
			? definitions
					.getSnapshotForContext(context, userId)
					.pipe(Effect.map((snapshot) => snapshot.entitySchemas))
			: definitions.findUserEntitySchemas(
					userId,
					slugs.map((slug) => ({ slug, owner: definitionOwner(null) })),
				);
	};
	const loadExecutionState = Effect.fn("loadAdmittedImportExecutionState")(function* (
		input: UserSandboxRunInput,
		runId: ImportRunId,
	) {
		const subject = input.principal.subject;
		if (subject.type !== "user") {
			return yield* Effect.fail("Admitted ingestion execution settings are unavailable");
		}
		const state = yield* sourceStates
			.load({ runId, userId: subject.userId, accountGeneration: subject.accountGeneration })
			.pipe(Effect.mapError(() => "Admitted ingestion execution settings are unavailable"));
		const plugin = input.principal.pluginRevision;
		if (
			!plugin ||
			state.pluginId !== plugin.id ||
			state.pluginRevision.id !== plugin.id ||
			state.pluginRevision.revisionId !== plugin.revisionId ||
			state.pluginRevision.configRevisionId !== plugin.configRevisionId
		) {
			return yield* Effect.fail("Admitted ingestion execution settings are unavailable");
		}
		return state;
	});
	const loadOAuthIntegrationRun = Effect.fn("loadOAuthIntegrationRun")(function* (
		rawInput: SandboxRunInput,
		operation: "getOAuthAccessToken" | "invalidateOAuthAccessToken",
		field: string,
	) {
		const input = yield* requireSandboxCapabilityInput(rawInput, operation);
		const { subject, pluginRevision } = input.principal;
		if (
			subject.integrationId === undefined ||
			subject.integrationRunId === undefined ||
			pluginRevision === null
		) {
			return yield* sandboxHostFailure(
				`${operation} is available only to integration run executions`,
				{ operation, code: "unavailable-operation" },
			);
		}
		if (!input.principal.metadata.oauthConnectionFields?.includes(field)) {
			return yield* Effect.fail(`OAuth connection field "${field}" is not declared by this script`);
		}
		const { integrationId, integrationRunId } = subject;
		const state = yield* loadExecutionState(input, integrationRunId);
		const integration = state.executionSettings.integration;
		const connectionId = integration?.providerSpecifics[field];
		if (
			state.sourcePayload["integrationId"] !== integrationId ||
			!integration ||
			typeof connectionId !== "string" ||
			connectionId.length === 0
		) {
			return yield* Effect.fail("Admitted integration settings are unavailable");
		}
		return {
			field,
			integrationId,
			integrationRunId,
			userId: subject.userId,
			pluginId: pluginRevision.id,
			connectionId: OAuthConnectionId.make(connectionId),
		};
	});
	const writeInlineLifecycleItems = Effect.fnUntraced(function* <Item, Result>(
		options: LifecycleItemWrite<Item, Result> & { readonly capability: SandboxHostCapability },
	) {
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
			const preferences = yield* auth
				.getUserPreferences(userId)
				.pipe(
					Effect.mapError((error) =>
						error.message.startsWith("Invalid stored user preferences:")
							? "Invalid stored user preferences"
							: error,
					),
				);
			if (!preferences) {
				return yield* Effect.fail("User not found");
			}
			return { disableIntegrations: preferences.disableIntegrations };
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
				.pipe(Effect.flatMap(toSandboxCreateEventsResult));
		});
	const requestEventStreamWork = (
		rawInput: SandboxRunInput,
		request: Parameters<AdditionalSandboxHostImplementationMap["requestEventStreamWork"]>[1],
		reference: Parameters<AdditionalSandboxHostImplementationMap["requestEventStreamWork"]>[2],
	) =>
		sandboxHostEffect(
			Effect.gen(function* () {
				const input = yield* requireSandboxCapabilityInput(rawInput, "requestEventStreamWork");
				const userId = sandboxRunUserId(input);
				if (userId === null) {
					return yield* Effect.fail("requestEventStreamWork requires a user execution");
				}
				const accountGeneration = input.principal.subject.accountGeneration;
				if (!accountGeneration || accountGeneration.userId !== userId) {
					return yield* Effect.fail("requestEventStreamWork requires an active user account");
				}
				const pluginPin = input.principal.pluginRevision;
				if (!pluginPin) {
					return yield* Effect.fail("requestEventStreamWork requires a pinned plugin script");
				}
				const targetRequest = {
					index: 0,
					kind: "activity",
					name: "event-stream-processor",
					args: { input: null, scriptSlug: reference.scriptSlug },
				} satisfies WorkflowDurableCallRequest;
				if (!isDeclaredExecutableCall(input.principal.metadata, targetRequest)) {
					return yield* Effect.fail("Event stream processor is not a declared script dependency");
				}
				const target = yield* sandboxRepository.resolveWorkflowCallScript(pluginPin, targetRequest);
				if (target?.kind !== "script") {
					return yield* Effect.fail("Event stream processor script could not be resolved");
				}
				const workId = yield* eventStreamWork
					.request({
						request,
						pluginPin,
						accountGeneration,
						processorScriptId: target.scriptId,
						command: yield* sandboxLifecycleCommand(
							input,
							userLifecycleSource(input),
							"requestEventStreamWork",
						),
					})
					.pipe(Effect.mapError((error) => error.message));
				return { workId };
			}),
		);

	return {
		requestEventStreamWork,
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
		updateEvents: (rawInput, items) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const [decoded] = yield* Schema.decodeEffect(updateEventsArgsSchema)([items]);
					const input = yield* lifecycle.updateEvents.validate(rawInput, decoded);
					return yield* lifecycle.updateEvents.commit(input);
				}),
			),
		deleteEvents: (rawInput, eventIds) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const [decoded] = yield* Schema.decodeEffect(deleteEventsArgsSchema)([eventIds]);
					const input = yield* lifecycle.deleteEvents.validate(rawInput, decoded);
					return yield* lifecycle.deleteEvents.commit(input);
				}),
			),
		getOAuthAccessToken: (rawInput, options) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const binding = yield* loadOAuthIntegrationRun(
						rawInput,
						"getOAuthAccessToken",
						options.field,
					);
					return yield* oauthConnections
						.accessTokenForIntegrationRun(binding)
						.pipe(Effect.mapError((error) => error.message));
				}),
			),
		changeUserRelationships: (rawInput, batches) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* lifecycle.changeUserRelationships.validate(rawInput, batches);
					const results = yield* writeInlineLifecycleItems({
						capability: "changeUserRelationships",
						...lifecycle.changeUserRelationships.itemWrite(input),
					});
					return lifecycle.changeUserRelationships.value(results);
				}),
			),
		upsertGlobalRelationships: (rawInput, groups) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* lifecycle.upsertGlobalRelationships.validate(rawInput, groups);
					const results = yield* writeInlineLifecycleItems({
						capability: "upsertGlobalRelationships",
						...lifecycle.upsertGlobalRelationships.itemWrite(input),
					});
					return lifecycle.upsertGlobalRelationships.value(results);
				}),
			),
		invalidateOAuthAccessToken: (rawInput, options) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const binding = yield* loadOAuthIntegrationRun(
						rawInput,
						"invalidateOAuthAccessToken",
						options.field,
					);
					return yield* oauthConnections
						.invalidateAccessTokenForIntegrationRun({
							...binding,
							accessToken: options.accessToken,
						})
						.pipe(Effect.mapError((error) => error.message));
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
						.pipe(Effect.map((rows) => rows.map(toSandboxIntegration))),
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
		getPluginConfig: (input, rawAccess) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const access = yield* Effect.all({
						required: normalizeConfigKeys(rawAccess.required ?? []),
						optional: normalizeConfigKeys(rawAccess.optional ?? []),
					});
					const revision = input.principal.pluginRevision;
					if (!revision) {
						return yield* sandboxHostFailure(
							"Plugin config is available only to active plugin scripts",
							{ operation: "getPluginConfig", code: "unavailable-operation" },
						);
					}
					const config = yield* pluginRuntime.resolvePluginConfigContext({
						id: revision.configRevisionId,
						ownerUserId: revision.ownerId,
						pluginRevisionId: revision.revisionId,
					});
					const values = yield* getPluginConfig({
						access,
						metadata: input.principal.metadata,
						context: { config, kind: "installation", configSchema: revision.configSchema },
					});
					return yield* encodeConfigValues(values);
				}),
			),
		getUserSettings: (rawInput) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "getUserSettings");
					const plugin = input.principal.pluginRevision;
					if (!plugin) {
						return yield* sandboxHostFailure("Plugin user settings require a plugin execution", {
							operation: "getUserSettings",
							code: "unavailable-operation",
						});
					}
					const row = yield* pluginInstallations.findUserSettingsForRevision({
						pluginId: plugin.id,
						pluginRevisionId: plugin.revisionId,
						userId: UserId.make(userSandboxRunUserId(input)),
					});
					if (!row) {
						return yield* Effect.fail("Plugin installation not found");
					}
					const runId = admittedImportRunId(input);
					if (runId) {
						const state = yield* loadExecutionState(input, runId);
						if (state.pluginInstallationId !== row.installationId) {
							return yield* Effect.fail("Admitted ingestion execution settings are unavailable");
						}
						return state.executionSettings.userSettings;
					}
					const settingsSchema = row.manifest.userSettingsSchema;
					if (!settingsSchema) {
						return {};
					}
					return yield* resolveStoredPluginUserSettings(settingsSchema, row.userSettings);
				}),
			),
		getCurrentIntegration: (rawInput) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "getCurrentIntegration");
					const integrationId = sandboxRunIntegrationId(input);
					if (!integrationId) {
						return yield* sandboxHostFailure(
							"getCurrentIntegration is available only to executions scoped to an integration",
							{ code: "unavailable-operation", operation: "getCurrentIntegration" },
						);
					}
					const integration = yield* integrationsRepository.getForUser({
						integrationId: IntegrationId.make(integrationId),
						userId: UserId.make(userSandboxRunUserId(input)),
					});
					if (!integration) {
						return yield* Effect.fail("Integration not found");
					}
					const runId = admittedImportRunId(input);
					if (!runId) {
						return toSandboxIntegration(integration);
					}
					const state = yield* loadExecutionState(input, runId);
					if (
						state.pluginInstallationId !== integration.pluginInstallationId ||
						state.sourcePayload["integrationId"] !== integration.id
					) {
						return yield* Effect.fail("Admitted integration settings are unavailable");
					}
					if (!state.executionSettings.integration) {
						return yield* Effect.fail("Admitted integration settings are unavailable");
					}
					return toSandboxIntegration({ ...integration, ...state.executionSettings.integration });
				}),
			),
		createUserEntity: (rawInput, rawItem) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "createUserEntity");
					const [item] = yield* Schema.decodeEffect(createUserEntityArgsSchema)([rawItem]);
					const revision = input.principal.pluginRevision;
					const userId = UserId.make(userSandboxRunUserId(input));
					const owner = definitionOwner(revision?.id ?? null);
					const schemas = yield* readEntitySchemas(input, [item.entitySchemaSlug]);
					const definition = schemas[definitionKey("entity", owner, item.entitySchemaSlug)];
					if (
						!revision?.schemaScope.entitySchemaSlugs.includes(item.entitySchemaSlug) ||
						!definition ||
						definition.pluginId !== revision.id
					) {
						return yield* sandboxHostFailure("Entity schema is not owned by the executing plugin", {
							code: "unavailable-operation",
							operation: "createUserEntity",
						});
					}
					const command = yield* sandboxLifecycleCommand(
						input,
						userLifecycleSource(input),
						"createUserEntity",
					);
					const { entity, warnings } = yield* entities.create({
						userId,
						scope: "user",
						name: item.name,
						lifecycle: command,
						properties: item.properties,
						entitySchema: { owner, slug: EntitySchemaSlug.make(item.entitySchemaSlug) },
					});
					yield* reportSandboxLifecycleWarnings("createUserEntity", warnings);
					return { entityId: entity.id };
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

							return readEntitySchemas(input, resolvedEntitySchemaSlugs).pipe(
								Effect.flatMap((entitySchemas) =>
									Effect.forEach(resolvedEntitySchemaSlugs, (entitySchemaSlug) => {
										const entitySchema =
											entitySchemas[
												definitionKey(
													"entity",
													definitionOwner(input.principal.pluginRevision?.id ?? null),
													entitySchemaSlug,
												)
											];
										return entitySchema
											? Effect.succeed(
													Object.values(entitySchema.eventSchemas).map((eventSchema) => ({
														entitySchemaSlug,
														id: eventSchema.slug,
														slug: eventSchema.slug,
														name: eventSchema.name,
														propertiesSchema: toSandboxJsonValue(eventSchema.propertiesSchema),
														pluginId:
															eventSchema.pluginId === null
																? null
																: PluginId.make(eventSchema.pluginId),
													})),
												)
											: Effect.fail("Entity schema not found");
									}).pipe(Effect.map((schemas) => schemas.flat())),
								),
							);
						}),
					),
				),
				sandboxHostEffect,
			),
		ensureUserEntities: (rawInput, items) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "ensureUserEntities");
					const revision = input.principal.pluginRevision;
					const userId = UserId.make(userSandboxRunUserId(input));
					const entitySchemas = yield* readEntitySchemas(
						input,
						items.map(({ entitySchemaSlug }) => entitySchemaSlug),
					);
					for (const item of items) {
						const definition =
							entitySchemas[
								definitionKey(
									"entity",
									definitionOwner(revision?.id ?? null),
									item.entitySchemaSlug,
								)
							];
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
					const results = yield* entities.ensureUserEntities(
						userId,
						items.map(({ entitySchemaSlug, ...item }) => ({
							...item,
							entitySchema: {
								owner: definitionOwner(revision?.id ?? null),
								slug: EntitySchemaSlug.make(entitySchemaSlug),
							},
						})),
						command,
					);
					yield* reportSandboxLifecycleWarnings(
						"ensureUserEntities",
						results.flatMap((result) => result.warnings),
					);
					return results.map(({ entityId, wasInserted }) => ({ entityId, wasInserted }));
				}),
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
									return yield* sandboxHostFailure(
										"executeRyotql system access requires a pinned plugin script",
										{ operation: "executeRyotql", code: "unavailable-operation" },
									);
								}
								const document = yield* decodeRyotQLDocument(query);
								return yield* ryotqlService.executeForPlugin(
									{
										pluginId: revision.id,
										pluginRevisionId: revision.revisionId,
										...revision.schemaScope,
									},
									document,
									SANDBOX_LIMITS.ryotqlResultBytes,
								);
							}),
						);
					}
					return sandboxHostEffect(
						Effect.gen(function* () {
							const document = yield* decodeRyotQLDocument(query);
							const userId = sandboxRunUserId(input);
							if (userId === null) {
								return yield* sandboxHostFailure("executeRyotql requires a user execution", {
									operation: "executeRyotql",
									code: "unavailable-operation",
								});
							}
							return yield* ryotqlService.executeForUser(
								userId,
								null,
								"plugin",
								document,
								"standard",
								SANDBOX_LIMITS.ryotqlResultBytes,
								sandboxDefinitionReadContext(input),
							);
						}),
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

							return readEntitySchemas(input, resolvedEntitySchemaSlugs).pipe(
								Effect.flatMap((entitySchemas) =>
									Effect.forEach(resolvedEntitySchemaSlugs, (entitySchemaSlug) => {
										const definition =
											entitySchemas[
												definitionKey(
													"entity",
													definitionOwner(input.principal.pluginRevision?.id ?? null),
													entitySchemaSlug,
												)
											];
										if (!definition) {
											return Effect.fail("Entity schema not found");
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
											entitySchemas: resolvedEntitySchemaSlugs.map((slug) => ({
												slug: EntitySchemaSlug.make(slug),
												owner: definitionOwner(input.principal.pluginRevision?.id ?? null),
											})),
										});
										const providersBySchema = new Map<
											string,
											Array<{ name: string; providerId: string }>
										>();
										for (const { provider, entitySchemaSlug } of links) {
											if (provider.pluginId !== input.principal.pluginRevision?.id) {
												continue;
											}
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
											pluginId:
												definition.pluginId === null ? null : PluginId.make(definition.pluginId),
										}));
									}).pipe(Effect.mapError(unknownToMessage)),
								),
							);
						}),
					),
				),
				sandboxHostEffect,
			),
	} satisfies AdditionalSandboxHostImplementationMap;
});
