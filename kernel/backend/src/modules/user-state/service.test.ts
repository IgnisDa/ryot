import { PgClient } from "@effect/sql-pg";
import { expect, it } from "@effect/vitest";
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
import { Effect, Layer, Schema } from "effect";
import { assert } from "vitest";

import { LifecyclePlanner, type LifecyclePlan } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
import { databaseLayer } from "#lib/test-utils/effect";
import {
	triggerFixture,
	withLifecycleBatchPlanning,
} from "#modules/automations/lifecycle.test-support";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import {
	EventsService,
	type PreparedEventDelete,
	type PreparedEventUpdate,
} from "#modules/events/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
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

const mockPluginRuntime = Layer.mock(PluginRuntimeResolver);

const makePluginRuntimeLayer = (
	mergeIdentityProperties: ReadonlyArray<string> = [],
	deniedOperationsBySchema: Readonly<Record<string, ReadonlyArray<"clear" | "merge">>> = {},
) =>
	mockPluginRuntime({
		getEffectiveDefinitions: () =>
			Effect.succeed(
				makeDefinitionRegistry({
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
				}).getSnapshot(),
			),
	});

const makeServiceLayer = (
	options: {
		database?: Layer.Layer<Database>;
		eventsService?: ReturnType<typeof makeEventsService>;
		pluginRuntime?: ReturnType<typeof makePluginRuntimeLayer>;
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
				options.database ?? databaseLayer,
				Layer.succeed(PgClient.PgClient, Object.create(null)),
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
				options.pluginRuntime ?? makePluginRuntimeLayer(),
				options.entitiesRepository ?? makeEntitiesRepository(),
				options.eventsRepository ?? makeEventsRepository(),
				options.eventsService ?? makeEventsService(),
				options.relationshipsRepository ?? makeRelationshipsRepository(),
				options.relationshipsService ?? makeRelationshipsService(),
			),
		),
	);

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

it.effect("rejects clearing user state when the entity schema denies it", () => {
	const layer = makeServiceLayer({
		pluginRuntime: makePluginRuntimeLayer([], { library: ["clear", "merge"] }),
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: true,
					entityName: "Library",
					entityUserId: user.id,
					entitySchemaPluginId: null,
					propertiesSchema: { fields: {} },
					entityId: EntityId.make("library-entity"),
					entitySchemaSlug: EntitySchemaSlug.make("library"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.clearUserState(user, EntityId.make("library-entity"), command),
		);

		assertExitFails(
			exit,
			new UserStateBadRequest({ reason: { operation: "clear", code: "operation-denied" } }),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("deletes matching events through EventsService when clearing user state", () => {
	const deletedEventIds: EventId[] = [];
	const layer = makeServiceLayer({
		relationshipsRepository: makeRelationshipsRepository({
			listUserRelationshipsForEntityWithProvenance: () => Effect.succeed([]),
		}),
		eventsRepository: makeEventsRepository({
			listUserEventIdsForEntity: () =>
				Effect.succeed([EventId.make("event-1"), EventId.make("event-2")]),
		}),
		eventsService: makeEventsService({
			persistPreparedDelete: () =>
				Effect.succeed({ plans: [], result: EventId.make("deleted-event") }),
			prepareDelete: (input) =>
				Effect.sync(() => {
					deletedEventIds.push(input.eventId);
					return preparedEventDelete;
				}),
		}),
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: false,
					entityName: "Dune",
					entityUserId: user.id,
					entitySchemaPluginId: null,
					propertiesSchema: { fields: {} },
					entityId: EntityId.make("entity-1"),
					entitySchemaSlug: EntitySchemaSlug.make("record"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const result = yield* service.clearUserState(user, EntityId.make("entity-1"), command);

		expect(result).toEqual({
			warnings: [],
			deletedEventsCount: 2,
			deletedRelationshipsCount: 0,
			entityId: EntityId.make("entity-1"),
		});
		expect(deletedEventIds).toEqual([EventId.make("event-1"), EventId.make("event-2")]);
	}).pipe(Effect.provide(layer));
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

it.effect(
	"prepares all clear mutations before one persistence phase and aggregates warnings",
	() => {
		const calls: string[] = [];
		const batches: AutomationTrigger[] = [];
		const eventPlans = [
			deletePlan("event-trigger-1", "event"),
			deletePlan("event-trigger-2", "event"),
		];
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
		const transactionDatabase = Object.create(null);
		const layer = makeServiceLayer({
			eventsRepository: makeEventsRepository({
				listUserEventIdsForEntity: () =>
					Effect.succeed([EventId.make("event-1"), EventId.make("event-2")]),
			}),
			planner: Layer.mock(LifecyclePlanner)(
				withLifecycleBatchPlanning({
					plan: ({ trigger }) =>
						Effect.sync(() => {
							batches.push(trigger);
							return { trigger, runs: [], policies: [], wasCreated: true };
						}),
				}),
			),
			lifecycleExecution: Layer.mock(LifecycleExecution)({
				dispatch: (plans) =>
					Effect.sync(() => {
						calls.push(`dispatch:${plans.map(({ triggerId }) => triggerId).join(",")}`);
						return [eventWarning, relationshipWarning];
					}),
			}),
			database: Layer.succeed(
				Database,
				Database.of(
					Object.assign(Object.create(null), {
						transaction: ((callback) => {
							calls.push("transaction");
							return callback(transactionDatabase);
						}) satisfies Database["Service"]["transaction"],
					}),
				),
			),
			entitiesRepository: makeEntitiesRepository({
				getEntityScopeForUser: () =>
					Effect.succeed({
						isBuiltin: false,
						entityName: "Dune",
						entityUserId: user.id,
						entitySchemaPluginId: null,
						propertiesSchema: { fields: {} },
						entityId: EntityId.make("entity-1"),
						entitySchemaSlug: EntitySchemaSlug.make("record"),
					}),
			}),
			relationshipsService: makeRelationshipsService({
				prepareUserDelete: () =>
					Effect.sync(() => {
						calls.push("prepare:relationship");
						return preparedRelationshipDelete;
					}),
				persistPreparedUserDelete: () =>
					Effect.sync(() => {
						calls.push("persist:relationship");
						return { plans: [relationshipPlan], result: persistedRelationship };
					}),
			}),
			eventsService: makeEventsService({
				prepareDelete: () =>
					Effect.sync(() => {
						calls.push("prepare:event");
						return preparedEventDelete;
					}),
				persistPreparedDelete: () =>
					Effect.sync(() => {
						calls.push("persist:event");
						const plan = eventPlans[calls.filter((call) => call === "persist:event").length - 1];
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
		});

		return Effect.gen(function* () {
			const service = yield* UserStateService;
			const result = yield* service.clearUserState(user, EntityId.make("entity-1"), command);

			expect(result.warnings).toEqual([eventWarning, relationshipWarning]);
			expect(
				batches.map(({ payload }) =>
					payload?.operation === "batch" ? [payload.resource, payload.items.length] : null,
				),
			).toEqual([
				["event", 2],
				["relationship", 1],
			]);
			expect(calls).toEqual([
				"prepare:event",
				"prepare:event",
				"prepare:relationship",
				"transaction",
				"persist:event",
				"persist:event",
				"persist:relationship",
				`dispatch:${["event-trigger-1", "event-trigger-2", "relationship-trigger", ...batches.map(({ id }) => id)].join(",")}`,
			]);
		}).pipe(Effect.provide(layer));
	},
);

it.effect("does not persist any clear mutation when preparation fails", () => {
	const calls: string[] = [];
	const failure = new DbError({ message: "policy failed" });
	const layer = makeServiceLayer({
		eventsRepository: makeEventsRepository({
			listUserEventIdsForEntity: () =>
				Effect.succeed([EventId.make("event-1"), EventId.make("event-2")]),
		}),
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: false,
					entityName: "Dune",
					entityUserId: user.id,
					entitySchemaPluginId: null,
					propertiesSchema: { fields: {} },
					entityId: EntityId.make("entity-1"),
					entitySchemaSlug: EntitySchemaSlug.make("record"),
				}),
		}),
		eventsService: makeEventsService({
			persistPreparedDelete: () =>
				Effect.sync(() => {
					calls.push("persist");
					return { plans: [], result: EventId.make("event-1") };
				}),
			prepareDelete: ({ eventId }) =>
				Effect.sync(() => calls.push(`prepare:${eventId}`)).pipe(
					Effect.andThen(eventId === "event-1" ? Effect.succeed(preparedEventDelete) : failure),
				),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.clearUserState(user, EntityId.make("entity-1"), command),
		);

		assertExitFails(exit, failure);
		expect(calls).toEqual(["prepare:event-1", "prepare:event-2"]);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging an entity into itself", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.mergeUserState(
				user,
				{ mergeFrom: EntityId.make("entity-id"), mergeInto: EntityId.make("entity-id") },
				command,
			),
		);

		assertExitFails(exit, new UserStateBadRequest({ reason: { code: "same-entity-merge" } }));
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when one merge entity is not visible", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(entityId === "from" ? makeMergeScope({ entityId }) : null),
		}),
	});

	return Effect.gen(function* () {
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
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging when either source or destination schema denies it", () => {
	const layer = makeServiceLayer({
		pluginRuntime: makePluginRuntimeLayer([], { blocked: ["merge"] }),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						entitySchemaSlug: entityId.includes("blocked") ? "blocked" : "record",
					}),
				),
		}),
	});

	return Effect.gen(function* () {
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
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging entities from different schemas", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						entitySchemaSlug: entityId === "from" ? "schema-a" : "schema-b",
					}),
				),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.mergeUserState(
				user,
				{ mergeFrom: EntityId.make("from"), mergeInto: EntityId.make("into") },
				command,
			),
		);

		assertExitFails(exit, new UserStateBadRequest({ reason: { code: "entity-schema-mismatch" } }));
	}).pipe(Effect.provide(layer));
});

it.effect("allows merging entities with matching declared identity properties", () => {
	const layer = makeServiceLayer({
		pluginRuntime: makePluginRuntimeLayer(["kind"]),
		eventsRepository: makeEventsRepository({ listUserEventIdsForEntity: () => Effect.succeed([]) }),
		relationshipsRepository: makeRelationshipsRepository({
			listUserRelationshipsForEntityWithProvenance: () => Effect.succeed([]),
		}),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(makeMergeScope({ entityId, properties: { kind: "novel" } })),
		}),
	});

	return Effect.gen(function* () {
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
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging entities with mismatched declared identity properties", () => {
	const layer = makeServiceLayer({
		pluginRuntime: makePluginRuntimeLayer(["kind"]),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						properties: { kind: entityId === "from" ? "novel" : "anthology" },
					}),
				),
		}),
	});

	return Effect.gen(function* () {
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
			new UserStateBadRequest({ reason: { property: "kind", code: "identity-property-mismatch" } }),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("moves events and relationships when the schema has no merge identity metadata", () => {
	const calls: string[] = [];
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) => Effect.succeed(makeMergeScope({ entityId })),
		}),
		eventsRepository: makeEventsRepository({
			listUserEventIdsForEntity: () =>
				Effect.succeed([EventId.make("event-1"), EventId.make("event-2")]),
		}),
		eventsService: makeEventsService({
			persistPreparedUpdate: () =>
				Effect.sync(() => {
					calls.push("persist:event");
					return { plans: [], result: EventId.make("updated-event") };
				}),
			prepareUpdate: (input, item) =>
				Effect.sync(() => {
					calls.push(
						`prepare:${input.eventId}:${input.mergeFrom}->${input.mergeInto}:${item.itemIdentity}`,
					);
					return preparedEventUpdate;
				}),
		}),
		relationshipsService: makeRelationshipsService({
			persistPreparedUserCreate: () =>
				Effect.sync(() => {
					calls.push("persist:relationship:create");
					return { plans: [], result: persistedRelationship };
				}),
			persistPreparedUserDelete: () =>
				Effect.sync(() => {
					calls.push("persist:relationship:delete");
					return { plans: [], result: persistedRelationship };
				}),
			prepareUserDelete: (input, item) =>
				Effect.sync(() => {
					calls.push(
						`prepare:${input.sourceEntityId}->${input.targetEntityId}:delete:${item.itemIdentity}`,
					);
					return preparedRelationshipDelete;
				}),
			prepareUserCreate: (input, item) =>
				Effect.sync(() => {
					calls.push(
						`prepare:${input.sourceEntityId}->${input.targetEntityId}:create:${item.itemIdentity}`,
					);
					return preparedRelationshipCreate;
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
	});

	return Effect.gen(function* () {
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
		expect(calls).toEqual([
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
	}).pipe(Effect.provide(layer));
});

it.effect("returns a typed user-state failure when the relationship schema is inactive", () => {
	const mergeFrom = EntityId.make("from");
	const mergeInto = EntityId.make("into");
	const layer = makeServiceLayer({
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
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		assertExitFails(
			yield* Effect.exit(service.mergeUserState(user, { mergeFrom, mergeInto }, command)),
			new UserStateBadRequest({ reason: { code: "relationship-merge-failed" } }),
		);
	}).pipe(Effect.provide(layer));
});
