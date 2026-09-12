import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import {
	UserStateBadRequest,
	UserStateNotFound,
} from "@ryot-app/contract/modules/user-state/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	AutomationHookSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	AutomationExecutionId,
	AutomationRunId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { assert } from "vitest";

import { LifecyclePlanner, type LifecyclePlan } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
import { databaseLayer } from "#lib/test-utils/effect";
import {
	triggerFixture,
	withLifecycleBatchPlanning,
} from "#modules/automations/lifecycle.test-support";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { buildDefinitionSnapshot } from "#modules/definition-registry/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import {
	EventsService,
	type PreparedEventDelete,
	type PreparedEventUpdate,
} from "#modules/events/service";
import type {
	PreparedUserRelationshipCreate,
	PreparedUserRelationshipDelete,
} from "#modules/relationships/prepared-mutations";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { UserStateService } from "./service";

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
} satisfies CurrentUserValue;

const command = rootLifecycleCommand({
	source: "api",
	itemIdentity: "user-state",
	initiator: { id: user.id, kind: "user" },
	occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
	executionId: AutomationExecutionId.make("user-state-execution"),
});

type PersistedRelationship = Effect.Success<
	ReturnType<RelationshipsService["Service"]["persistPreparedUserDelete"]>
>["result"];

const preparedEventDelete: PreparedEventDelete = Object.create(null);
const preparedEventUpdate: PreparedEventUpdate = Object.create(null);
const persistedRelationship: PersistedRelationship = Object.create(null);
const preparedRelationshipCreate: PreparedUserRelationshipCreate = Object.create(null);
const preparedRelationshipDelete: PreparedUserRelationshipDelete = Object.create(null);

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ ...overrides });

const mockEventsRepository = Layer.mock(EventsRepository);

const makeEventsRepository = (overrides: MockOverrides<typeof mockEventsRepository> = {}) =>
	mockEventsRepository({ ...overrides });

const mockEventsService = Layer.mock(EventsService);

const makeEventsService = (overrides: MockOverrides<typeof mockEventsService> = {}) =>
	mockEventsService({ ...overrides });

const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) => mockRelationshipsRepository({ ...overrides });

const mockRelationshipsService = Layer.mock(RelationshipsService);

const makeRelationshipsService = (overrides: MockOverrides<typeof mockRelationshipsService> = {}) =>
	mockRelationshipsService({ ...overrides });

const makeDefinitionsLayer = (
	mergeIdentityProperties: ReadonlyArray<string> = [],
	deniedOperationsBySchema: Readonly<Record<string, ReadonlyArray<"clear" | "merge">>> = {},
) =>
	Layer.mock(DefinitionRepository)({
		findUserEntitySchemas: () =>
			Effect.succeed(
				buildDefinitionSnapshot({
					savedViews: [],
					signalSchemas: [],
					relationshipSchemas: [],
					entitySchemas: [
						{
							icon: "record",
							name: "Record",
							slug: "record",
							eventSchemas: [],
							pluginSlug: "test",
							mergeIdentityProperties,
							propertiesSchema: {
								fields: { kind: { label: "Kind", type: "string", description: "Record kind" } },
							},
							userState: deniedOperationsBySchema["record"]
								? { deniedOperations: deniedOperationsBySchema["record"] }
								: undefined,
						},
						...Object.entries(deniedOperationsBySchema)
							.filter(([slug]) => slug !== "record")
							.map(([slug, deniedOperations]) => ({
								slug,
								name: slug,
								icon: "box",
								eventSchemas: [],
								pluginSlug: "test",
								userState: { deniedOperations },
								propertiesSchema: { fields: {} },
							})),
					],
				}).entitySchemas,
			),
	});

const makeServiceLayer = (
	options: {
		eventsService?: ReturnType<typeof makeEventsService>;
		definitions?: ReturnType<typeof makeDefinitionsLayer>;
		eventsRepository?: ReturnType<typeof makeEventsRepository>;
		entitiesRepository?: ReturnType<typeof makeEntitiesRepository>;
		relationshipsService?: ReturnType<typeof makeRelationshipsService>;
		relationshipsRepository?: ReturnType<typeof makeRelationshipsRepository>;
		lifecycleExecution?: Layer.Layer<LifecycleExecution>;
		planner?: Layer.Layer<LifecyclePlanner>;
	} = {},
) =>
	UserStateService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				options.planner ??
					Layer.mock(LifecyclePlanner)(
						withLifecycleBatchPlanning({ plan: () => Effect.die("unused") }),
					),
				options.lifecycleExecution ??
					Layer.mock(LifecycleExecution)({
						after: () => Effect.die("unused"),
						dispatch: () => Effect.succeed([]),
						executePolicy: () => Effect.die("unused"),
						skipQueuedPolicies: () => Effect.die("unused"),
					}),
				options.definitions ?? makeDefinitionsLayer(),
				options.entitiesRepository ?? makeEntitiesRepository(),
				options.eventsRepository ?? makeEventsRepository(),
				options.eventsService ?? makeEventsService(),
				options.relationshipsRepository ?? makeRelationshipsRepository(),
				options.relationshipsService ?? makeRelationshipsService(),
			),
		),
	);

const recordingServiceLayer = <A>(
	options: (tools: {
		readonly record: (observation: A) => Effect.Effect<void>;
		readonly recorded: Effect.Effect<ReadonlyArray<A>>;
		readonly session: DatabaseSession["Service"];
	}) => Parameters<typeof makeServiceLayer>[0],
) => {
	const Recorded = Context.Service<Effect.Effect<ReadonlyArray<A>>>("test/RecordedUserStateCalls");
	return {
		recorded: Effect.flatten(Recorded),
		layer: Layer.unwrap(
			Effect.gen(function* () {
				const observations = yield* Ref.make<ReadonlyArray<A>>([]);
				const recorded = Ref.get(observations);
				return makeServiceLayer(
					options({
						recorded,
						session: yield* DatabaseSession,
						record: (observation) => Ref.update(observations, (all) => [...all, observation]),
					}),
				).pipe(Layer.provideMerge(Layer.succeed(Recorded, recorded)));
			}),
		).pipe(Layer.provide(databaseLayer)),
	};
};

const makeMergeScope = (overrides: {
	entityId: EntityId;
	entitySchemaSlug?: string;
	properties?: Record<string, unknown>;
}) => ({
	isBuiltin: false,
	entityUserId: user.id,
	entityId: overrides.entityId,
	properties: overrides.properties ?? {},
	entitySchemaSlug: EntitySchemaSlug.make(overrides.entitySchemaSlug ?? "record"),
});

const recordEntityScope = () =>
	Effect.succeed({
		isBuiltin: false,
		entityName: "Dune",
		entityUserId: user.id,
		entitySchemaPluginId: null,
		propertiesSchema: { fields: {} },
		entityId: EntityId.make("entity-1"),
		entitySchemaSlug: EntitySchemaSlug.make("record"),
	});

layer(
	makeServiceLayer({
		definitions: makeDefinitionsLayer([], { "media-library": ["clear", "merge"] }),
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: true,
					entityName: "Library",
					entityUserId: user.id,
					entitySchemaPluginId: null,
					propertiesSchema: { fields: {} },
					entityId: EntityId.make("library-entity"),
					entitySchemaSlug: EntitySchemaSlug.make("media-library"),
				}),
		}),
	}),
)((test) => {
	test.effect("rejects clearing user state when the entity schema denies it", () =>
		Effect.gen(function* () {
			const service = yield* UserStateService;
			const exit = yield* Effect.exit(
				service.clearUserState(user, EntityId.make("library-entity"), command),
			);

			assertExitFails(
				exit,
				new UserStateBadRequest({ reason: { operation: "clear", code: "operation-denied" } }),
			);
		}),
	);
});

const deletedEvents = recordingServiceLayer<EventId>(({ record }) => ({
	entitiesRepository: makeEntitiesRepository({ getEntityScopeForUser: recordEntityScope }),
	relationshipsRepository: makeRelationshipsRepository({
		listUserRelationshipsForEntityWithProvenance: () => Effect.succeed([]),
	}),
	eventsRepository: makeEventsRepository({
		listUserEventIdsForEntity: () =>
			Effect.succeed([EventId.make("event-1"), EventId.make("event-2")]),
	}),
	eventsService: makeEventsService({
		prepareDelete: (input) => record(input.eventId).pipe(Effect.as(preparedEventDelete)),
		persistPreparedDelete: () =>
			Effect.succeed({ plans: [], result: EventId.make("deleted-event") }),
	}),
}));

layer(deletedEvents.layer)((test) => {
	test.effect("deletes matching events through EventsService when clearing user state", () =>
		Effect.gen(function* () {
			const service = yield* UserStateService;
			const result = yield* service.clearUserState(user, EntityId.make("entity-1"), command);

			expect(result).toEqual({
				warnings: [],
				deletedEventsCount: 2,
				deletedRelationshipsCount: 0,
				entityId: EntityId.make("entity-1"),
			});
			expect(yield* deletedEvents.recorded).toEqual([
				EventId.make("event-1"),
				EventId.make("event-2"),
			]);
		}),
	);
});

const snapshotFields = {
	properties: {},
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};
const deletePlan = (id: string, resource: "event" | "relationship"): LifecyclePlan => ({
	runs: [],
	policies: [],
	wasCreated: true,
	trigger: Schema.decodeUnknownSync(AutomationTrigger)({
		...triggerFixture(id),
		kind: { resource, category: "change", operation: "delete" },
		payload: {
			resource,
			category: "change",
			operation: "delete",
			before:
				resource === "event"
					? {
							...snapshotFields,
							id,
							entityId: "entity-1",
							sessionEntityId: null,
							entitySchemaSlug: "record",
							eventSchemaSlug: "progress",
							occurredAt: "2026-01-01T00:00:00.000Z",
						}
					: {
							...snapshotFields,
							id,
							sourceEntityId: "entity-1",
							targetEntityId: "target-1",
							relationshipSchemaSlug: "relationship-schema",
						},
		},
	}),
});

const eventPlans = [deletePlan("event-trigger-1", "event"), deletePlan("event-trigger-2", "event")];
const relationshipPlan = deletePlan("relationship-trigger", "relationship");
const eventWarning = {
	code: "required-hook-pending" as const,
	runId: AutomationRunId.make("event-run"),
	hookSlug: AutomationHookSlug.make("event-hook"),
};
const relationshipWarning = {
	code: "required-hook-failed" as const,
	runId: AutomationRunId.make("relationship-run"),
	hookSlug: AutomationHookSlug.make("relationship-hook"),
};

type ClearObservation =
	| { readonly kind: "call"; readonly call: string }
	| { readonly kind: "batch"; readonly trigger: AutomationTrigger };

const callsOf = (observations: ReadonlyArray<ClearObservation>) =>
	observations.flatMap((observation) => (observation.kind === "call" ? [observation.call] : []));

const clearPhases = recordingServiceLayer<ClearObservation>(({ record, session, recorded }) => {
	const call = (value: string) => record({ call: value, kind: "call" });
	return {
		entitiesRepository: makeEntitiesRepository({ getEntityScopeForUser: recordEntityScope }),
		eventsRepository: makeEventsRepository({
			listUserEventIdsForEntity: () =>
				Effect.succeed([EventId.make("event-1"), EventId.make("event-2")]),
		}),
		lifecycleExecution: Layer.mock(LifecycleExecution)({
			dispatch: (plans) =>
				call(`dispatch:${plans.map(({ triggerId }) => triggerId).join(",")}`).pipe(
					Effect.as([eventWarning, relationshipWarning]),
				),
		}),
		planner: Layer.mock(LifecyclePlanner)(
			withLifecycleBatchPlanning({
				plan: ({ trigger }) =>
					record({ trigger, kind: "batch" }).pipe(
						Effect.as({ trigger, runs: [], policies: [], wasCreated: true }),
					),
			}),
		),
		relationshipsService: makeRelationshipsService({
			prepareUserDelete: () =>
				call("prepare:relationship").pipe(Effect.as(preparedRelationshipDelete)),
			persistPreparedUserDelete: () =>
				Effect.gen(function* () {
					expect(yield* session.isTransactionActive).toBe(true);
					yield* call("persist:relationship");
					return { plans: [relationshipPlan], result: persistedRelationship };
				}),
		}),
		eventsService: makeEventsService({
			prepareDelete: () => call("prepare:event").pipe(Effect.as(preparedEventDelete)),
			persistPreparedDelete: () =>
				Effect.gen(function* () {
					expect(yield* session.isTransactionActive).toBe(true);
					yield* call("persist:event");
					const persisted = callsOf(yield* recorded).filter((value) => value === "persist:event");
					const plan = eventPlans[persisted.length - 1];
					assert(plan);
					return { plans: [plan], result: EventId.make("event-1") };
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listUserRelationshipsForEntityWithProvenance: () =>
				Effect.succeed([
					{
						properties: {},
						relationshipSchemaPluginId: null,
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
						sourceEntityId: EntityId.make("entity-1"),
						targetEntityId: EntityId.make("target-1"),
						id: RelationshipId.make("relationship-1"),
						relationshipSchemaSlug: RelationshipSchemaSlug.make("relationship-schema"),
					},
				]),
		}),
	};
});

layer(clearPhases.layer)((test) => {
	test.effect(
		"prepares all clear mutations before one persistence phase and aggregates warnings",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* UserStateService;
				const result = yield* service.clearUserState(user, EntityId.make("entity-1"), command);
				expect(yield* session.isTransactionActive).toBe(false);

				const observations = yield* clearPhases.recorded;
				const batches = observations.flatMap((observation) =>
					observation.kind === "batch" ? [observation.trigger] : [],
				);
				expect(result.warnings).toEqual([eventWarning, relationshipWarning]);
				expect(
					batches.map(({ payload }) =>
						payload?.operation === "batch" ? [payload.resource, payload.items.length] : null,
					),
				).toEqual([
					["event", 2],
					["relationship", 1],
				]);
				expect(callsOf(observations)).toEqual([
					"prepare:event",
					"prepare:event",
					"prepare:relationship",
					"persist:event",
					"persist:event",
					"persist:relationship",
					`dispatch:${["event-trigger-1", "event-trigger-2", "relationship-trigger", ...batches.map(({ id }) => id)].join(",")}`,
				]);
			}),
	);
});

const preparationFailure = new DbError({ message: "policy failed" });

const failedPreparation = recordingServiceLayer<string>(({ record }) => ({
	entitiesRepository: makeEntitiesRepository({ getEntityScopeForUser: recordEntityScope }),
	eventsRepository: makeEventsRepository({
		listUserEventIdsForEntity: () =>
			Effect.succeed([EventId.make("event-1"), EventId.make("event-2")]),
	}),
	eventsService: makeEventsService({
		persistPreparedDelete: () =>
			record("persist").pipe(Effect.as({ plans: [], result: EventId.make("event-1") })),
		prepareDelete: ({ eventId }) =>
			record(`prepare:${eventId}`).pipe(
				Effect.andThen(
					eventId === "event-1" ? Effect.succeed(preparedEventDelete) : preparationFailure,
				),
			),
	}),
}));

layer(failedPreparation.layer)((test) => {
	test.effect("does not persist any clear mutation when preparation fails", () =>
		Effect.gen(function* () {
			const service = yield* UserStateService;
			const exit = yield* Effect.exit(
				service.clearUserState(user, EntityId.make("entity-1"), command),
			);

			assertExitFails(exit, preparationFailure);
			expect(yield* failedPreparation.recorded).toEqual(["prepare:event-1", "prepare:event-2"]);
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("rejects merging an entity into itself", () =>
		Effect.gen(function* () {
			const service = yield* UserStateService;
			const exit = yield* Effect.exit(
				service.mergeUserState(
					user,
					{ mergeFrom: EntityId.make("entity-id"), mergeInto: EntityId.make("entity-id") },
					command,
				),
			);

			assertExitFails(exit, new UserStateBadRequest({ reason: { code: "same-entity-merge" } }));
		}),
	);
});

layer(
	makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(entityId === "from" ? makeMergeScope({ entityId }) : null),
		}),
	}),
)((test) => {
	test.effect("returns not found when one merge entity is not visible", () =>
		Effect.gen(function* () {
			const service = yield* UserStateService;
			const exit = yield* Effect.exit(
				service.mergeUserState(
					user,
					{ mergeFrom: EntityId.make("from"), mergeInto: EntityId.make("into") },
					command,
				),
			);

			assertExitFails(
				exit,
				new UserStateNotFound({
					reason: {
						code: "entity-not-found",
						entityIds: [EntityId.make("from"), EntityId.make("into")],
					},
				}),
			);
		}),
	);
});

layer(
	makeServiceLayer({
		definitions: makeDefinitionsLayer([], { blocked: ["merge"] }),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						entitySchemaSlug: entityId.includes("blocked") ? "blocked" : "record",
					}),
				),
		}),
	}),
)((test) => {
	test.effect("rejects merging when either source or destination schema denies it", () =>
		Effect.gen(function* () {
			const service = yield* UserStateService;
			const sourceDenied = yield* Effect.exit(
				service.mergeUserState(
					user,
					{
						mergeFrom: EntityId.make("blocked-source"),
						mergeInto: EntityId.make("allowed-destination"),
					},
					command,
				),
			);
			const destinationDenied = yield* Effect.exit(
				service.mergeUserState(
					user,
					{
						mergeFrom: EntityId.make("allowed-source"),
						mergeInto: EntityId.make("blocked-destination"),
					},
					command,
				),
			);

			const expected = new UserStateBadRequest({
				reason: { operation: "merge", code: "operation-denied" },
			});
			assertExitFails(sourceDenied, expected);
			assertExitFails(destinationDenied, expected);
		}),
	);
});

layer(
	makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						entitySchemaSlug: entityId === "from" ? "schema-a" : "schema-b",
					}),
				),
		}),
	}),
)((test) => {
	test.effect("rejects merging entities from different schemas", () =>
		Effect.gen(function* () {
			const service = yield* UserStateService;
			const exit = yield* Effect.exit(
				service.mergeUserState(
					user,
					{ mergeFrom: EntityId.make("from"), mergeInto: EntityId.make("into") },
					command,
				),
			);

			assertExitFails(
				exit,
				new UserStateBadRequest({ reason: { code: "entity-schema-mismatch" } }),
			);
		}),
	);
});

layer(
	makeServiceLayer({
		definitions: makeDefinitionsLayer(["kind"]),
		eventsRepository: makeEventsRepository({ listUserEventIdsForEntity: () => Effect.succeed([]) }),
		relationshipsRepository: makeRelationshipsRepository({
			listUserRelationshipsForEntityWithProvenance: () => Effect.succeed([]),
		}),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(makeMergeScope({ entityId, properties: { kind: "novel" } })),
		}),
	}),
)((test) => {
	test.effect("allows merging entities with matching declared identity properties", () =>
		Effect.gen(function* () {
			const service = yield* UserStateService;
			const result = yield* service.mergeUserState(
				user,
				{ mergeFrom: EntityId.make("from"), mergeInto: EntityId.make("into") },
				command,
			);

			expect(result).toEqual({
				warnings: [],
				mergeFrom: "from",
				mergeInto: "into",
				movedEventsCount: 0,
				movedRelationshipsCount: 0,
			});
		}),
	);
});

layer(
	makeServiceLayer({
		definitions: makeDefinitionsLayer(["kind"]),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						properties: { kind: entityId === "from" ? "novel" : "anthology" },
					}),
				),
		}),
	}),
)((test) => {
	test.effect("rejects merging entities with mismatched declared identity properties", () =>
		Effect.gen(function* () {
			const service = yield* UserStateService;
			const exit = yield* Effect.exit(
				service.mergeUserState(
					user,
					{ mergeFrom: EntityId.make("from"), mergeInto: EntityId.make("into") },
					command,
				),
			);

			assertExitFails(
				exit,
				new UserStateBadRequest({
					reason: { property: "kind", code: "identity-property-mismatch" },
				}),
			);
		}),
	);
});

const mergeMoves = recordingServiceLayer<string>(({ record }) => ({
	entitiesRepository: makeEntitiesRepository({
		getEntityMergeScopeForUser: ({ entityId }) => Effect.succeed(makeMergeScope({ entityId })),
	}),
	eventsRepository: makeEventsRepository({
		listUserEventIdsForEntity: () =>
			Effect.succeed([EventId.make("event-1"), EventId.make("event-2")]),
	}),
	eventsService: makeEventsService({
		persistPreparedUpdate: () =>
			record("persist:event").pipe(Effect.as({ plans: [], result: EventId.make("updated-event") })),
		prepareUpdate: (input, item) =>
			record(
				`prepare:${input.eventId}:${input.mergeFrom}->${input.mergeInto}:${item.itemIdentity}`,
			).pipe(Effect.as(preparedEventUpdate)),
	}),
	relationshipsService: makeRelationshipsService({
		persistPreparedUserCreate: () =>
			record("persist:relationship:create").pipe(
				Effect.as({ plans: [], result: persistedRelationship }),
			),
		persistPreparedUserDelete: () =>
			record("persist:relationship:delete").pipe(
				Effect.as({ plans: [], result: persistedRelationship }),
			),
		prepareUserDelete: (input, item) =>
			record(
				`prepare:${input.sourceEntityId}->${input.targetEntityId}:delete:${item.itemIdentity}`,
			).pipe(Effect.as(preparedRelationshipDelete)),
		prepareUserCreate: (input, item) =>
			record(
				`prepare:${input.sourceEntityId}->${input.targetEntityId}:create:${item.itemIdentity}`,
			).pipe(Effect.as(preparedRelationshipCreate)),
	}),
	relationshipsRepository: makeRelationshipsRepository({
		listUserRelationshipsForEntityWithProvenance: () =>
			Effect.succeed([
				{
					properties: {},
					relationshipSchemaPluginId: null,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					sourceEntityId: EntityId.make("from"),
					id: RelationshipId.make("relationship-1"),
					targetEntityId: EntityId.make("target-1"),
					relationshipSchemaSlug: RelationshipSchemaSlug.make("relationship-schema"),
				},
				{
					properties: {},
					relationshipSchemaPluginId: null,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					targetEntityId: EntityId.make("from"),
					id: RelationshipId.make("relationship-2"),
					sourceEntityId: EntityId.make("target-2"),
					relationshipSchemaSlug: RelationshipSchemaSlug.make("relationship-schema"),
				},
				{
					properties: {},
					relationshipSchemaPluginId: null,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					sourceEntityId: EntityId.make("from"),
					targetEntityId: EntityId.make("from"),
					id: RelationshipId.make("relationship-3"),
					relationshipSchemaSlug: RelationshipSchemaSlug.make("relationship-schema"),
				},
			]),
	}),
}));

layer(mergeMoves.layer)((test) => {
	test.effect("moves events and relationships when the schema has no merge identity metadata", () =>
		Effect.gen(function* () {
			const service = yield* UserStateService;
			const result = yield* service.mergeUserState(
				user,
				{ mergeFrom: EntityId.make("from"), mergeInto: EntityId.make("into") },
				command,
			);

			expect(result).toEqual({
				warnings: [],
				mergeFrom: "from",
				mergeInto: "into",
				movedEventsCount: 2,
				movedRelationshipsCount: 3,
			});
			expect(yield* mergeMoves.recorded).toEqual([
				"prepare:event-1:from->into:user-state:event:event-1:update",
				"prepare:event-2:from->into:user-state:event:event-2:update",
				"prepare:into->target-1:create:user-state:relationship:relationship-1:create",
				"prepare:from->target-1:delete:user-state:relationship:relationship-1:delete",
				"prepare:target-2->into:create:user-state:relationship:relationship-2:create",
				"prepare:target-2->from:delete:user-state:relationship:relationship-2:delete",
				"prepare:from->from:delete:user-state:relationship:relationship-3:delete",
				"persist:event",
				"persist:event",
				"persist:relationship:create",
				"persist:relationship:delete",
				"persist:relationship:create",
				"persist:relationship:delete",
				"persist:relationship:delete",
			]);
		}),
	);
});

const mergeFrom = EntityId.make("from");
const mergeInto = EntityId.make("into");

layer(
	makeServiceLayer({
		eventsRepository: makeEventsRepository({ listUserEventIdsForEntity: () => Effect.succeed([]) }),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) => Effect.succeed(makeMergeScope({ entityId })),
		}),
		relationshipsService: makeRelationshipsService({
			prepareUserCreate: () =>
				new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } }),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listUserRelationshipsForEntityWithProvenance: () =>
				Effect.succeed([
					{
						properties: {},
						sourceEntityId: mergeFrom,
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
						targetEntityId: EntityId.make("target"),
						id: RelationshipId.make("relationship-1"),
						relationshipSchemaPluginId: "inactive-plugin",
						relationshipSchemaSlug: RelationshipSchemaSlug.make("inactive"),
					},
				]),
		}),
	}),
)((test) => {
	test.effect("returns a typed user-state failure when the relationship schema is inactive", () =>
		Effect.gen(function* () {
			const service = yield* UserStateService;
			assertExitFails(
				yield* Effect.exit(service.mergeUserState(user, { mergeFrom, mergeInto }, command)),
				new UserStateBadRequest({ reason: { code: "relationship-merge-failed" } }),
			);
		}),
	);
});
