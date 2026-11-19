import { expect } from "bun:test";

import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EntityUserDataBadRequest,
	EntityUserDataNotFound,
} from "@ryot-app/contract/modules/entity-user-data/schemas";
import {
	definitionOwner,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	PluginId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { buildDefinitionSnapshot, type DefinitionSource } from "@ryot-app/definitions/snapshot";
import { makeUserSubject } from "@ryot-app/sandbox/host/run-input.test-support";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { partialFake } from "@ryot-app/testing/fakes";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import {
	triggerFixture,
	withLifecycleBatchPlanning,
} from "#modules/automations/lifecycle.test-support";
import { lifecycleBatchTriggers } from "#modules/automations/lifecycle/batch";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import {
	type LifecyclePlan,
	LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { EventsRepository } from "#modules/events/repository";
import type { PreparedUserRelationship } from "#modules/relationships/prepared-mutations";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import {
	makeUserPluginRevision,
	makeUserPrincipal,
} from "#modules/scripts/authorization/principal.test-support";
import { DatabaseSession } from "#platform/db/session";
import type { MockOverrides } from "#testing/effect";
import { databaseLayer } from "#testing/effect";

import { emptyEntityUserDataAttachments } from "./attachments.test-support";
import { EntityUserDataGraphRepository } from "./graph-repository";
import { EntityUserDataService } from "./service";

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: {
		weekStart: null,
		interfaceLocale: null,
		contentLanguage: null,
		reportingTimeZone: UTC,
		ratingScale: "hundred",
		disableIntegrations: false,
	},
} satisfies CurrentUserValue;

const command = {
	...rootLifecycleCommand({
		source: "api",
		lane: "interactive",
		accountUserId: user.id,
		itemIdentity: "entity-user-data",
		initiator: { id: user.id, kind: "user" },
		occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
		executionId: AutomationExecutionId.make("entity-user-data-execution"),
	}),
	writeContext: null,
	accountUserId: null,
};

type PersistedRelationship = Effect.Success<
	ReturnType<RelationshipsService["Service"]["persistPrepared"]>
>["result"];

const persistedRelationship = partialFake<PersistedRelationship>({});
const preparedRelationshipCreate = partialFake<PreparedUserRelationship>({ request: null });
const preparedRelationshipDelete = partialFake<PreparedUserRelationship>({ request: null });

const eventReferencesFor = (
	input: { readonly entityIds: ReadonlyArray<EntityId> },
	ids: ReadonlyArray<EventId>,
) => {
	const [entityId] = input.entityIds;
	assert(entityId);
	return ids.map((id) => ({ id, entityId, sessionEntityId: null }));
};

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ lockUserDataReferences: () => Effect.void, ...overrides });

const mockEventsRepository = Layer.mock(EventsRepository);

const makeEventsRepository = (overrides: MockOverrides<typeof mockEventsRepository> = {}) =>
	mockEventsRepository({ absorbFoldValues: () => Effect.void, ...overrides });

const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) =>
	mockRelationshipsRepository({
		listUserRelationshipsForEntitiesWithProvenance: () => Effect.succeed([]),
		...overrides,
	});

const mockRelationshipsService = Layer.mock(RelationshipsService);

const makeRelationshipsService = (overrides: MockOverrides<typeof mockRelationshipsService> = {}) =>
	mockRelationshipsService({ ...overrides });

const makeDefinitionsLayer = (
	mergeIdentityProperties: ReadonlyArray<string> = [],
	deniedOperationsBySchema: Readonly<Record<string, ReadonlyArray<"clear" | "merge">>> = {},
	pluginIds: ReadonlyArray<null | string> = [null],
	sourceOverrides: Partial<DefinitionSource> = {},
) =>
	Layer.mock(DefinitionRepository)({
		findUserEntitySchemas: () =>
			Effect.succeed(
				buildDefinitionSnapshot({
					savedViews: [],
					signalSchemas: [],
					calendarSources: [],
					relationshipSchemas: [],
					entitySchemas: [
						...pluginIds.map((pluginId): DefinitionSource["entitySchemas"][number] => ({
							pluginId,
							icon: "record",
							slug: "record",
							eventSchemas: [],
							mergeIdentityProperties,
							name: { key: "test.record" },
							propertiesSchema: {
								fields: { kind: { label: "Kind", type: "string", description: "Record kind" } },
							},
							userState: deniedOperationsBySchema["record"]
								? { deniedOperations: deniedOperationsBySchema["record"] }
								: undefined,
						})),
						...Object.entries(deniedOperationsBySchema)
							.filter(([slug]) => slug !== "record")
							.map(([slug, deniedOperations]) => ({
								slug,
								icon: "box",
								pluginId: null,
								eventSchemas: [],
								name: { key: `test.${slug}` },
								userState: { deniedOperations },
								propertiesSchema: { fields: {} },
							})),
					],
					...sourceOverrides,
				}).entitySchemas,
			),
	});

const makeServiceLayer = (
	options: {
		planner?: Layer.Layer<LifecyclePlanner>;
		definitions?: ReturnType<typeof makeDefinitionsLayer>;
		eventsRepository?: ReturnType<typeof makeEventsRepository>;
		graphRepository?: Layer.Layer<EntityUserDataGraphRepository>;
		entitiesRepository?: ReturnType<typeof makeEntitiesRepository>;
		relationshipsService?: ReturnType<typeof makeRelationshipsService>;
		relationshipsRepository?: ReturnType<typeof makeRelationshipsRepository>;
	} = {},
) =>
	EntityUserDataService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				options.graphRepository ??
					Layer.mock(EntityUserDataGraphRepository)({
						listChildren: () => Effect.succeed([]),
						listEvidence: () => Effect.succeed([]),
					}),
				databaseLayer,
				options.planner ??
					Layer.mock(LifecyclePlanner)(
						withLifecycleBatchPlanning({ plan: () => Effect.die("unused") }),
					),
				options.definitions ?? makeDefinitionsLayer(),
				options.entitiesRepository ?? makeEntitiesRepository(),
				options.eventsRepository ?? makeEventsRepository(),
				options.relationshipsRepository ?? makeRelationshipsRepository(),
				options.relationshipsService ?? makeRelationshipsService(),
				emptyEntityUserDataAttachments,
			),
		),
	);

const recordingServiceLayer = <A>(
	options: (tools: {
		readonly session: DatabaseSession["Service"];
		readonly recorded: Effect.Effect<ReadonlyArray<A>>;
		readonly record: (observation: A) => Effect.Effect<void>;
	}) => Parameters<typeof makeServiceLayer>[0],
) => {
	const Recorded = Context.Service<Effect.Effect<ReadonlyArray<A>>>(
		"test/RecordedEntityUserDataCalls",
	);
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

/** Plans a clear and writes it in one transaction, as `ChangeSets` does around its event changes. */
const clear = (entityId: EntityId, lifecycle: DomainLifecycleCommand = command) =>
	Effect.gen(function* () {
		const prepared = yield* (yield* EntityUserDataService).prepareClear(
			user.id,
			{ entityId, entitySchema: null },
			lifecycle,
		);
		const written = yield* (yield* DatabaseSession)
			.transaction(Effect.andThen(prepared.lock, prepared.write(Effect.succeed)))
			.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
		return { ...written, events: prepared.events };
	});

/** Plans a merge and writes it in one transaction, as `ChangeSets` does around its event changes. */
const merge = (
	payload: { readonly mergeFrom: EntityId; readonly mergeInto: EntityId },
	lifecycle: DomainLifecycleCommand = command,
	entitySchema: null | EntitySchemaReference = null,
) =>
	Effect.gen(function* () {
		const prepared = yield* (yield* EntityUserDataService).prepareMerge(
			user.id,
			{ ...payload, entitySchema },
			lifecycle,
		);
		const written = yield* (yield* DatabaseSession)
			.transaction(Effect.andThen(prepared.lock, prepared.write(Effect.succeed)))
			.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
		return { ...written, events: prepared.events };
	});

const makeMergeScope = (overrides: {
	entityId: EntityId;
	entitySchemaSlug?: string;
	entitySchemaPluginId?: null | string;
	properties?: Record<string, unknown>;
}) => ({
	isBuiltin: false,
	entityUserId: user.id,
	entityId: overrides.entityId,
	properties: overrides.properties ?? {},
	entitySchemaPluginId: overrides.entitySchemaPluginId ?? null,
	entitySchemaSlug: EntitySchemaSlug.make(overrides.entitySchemaSlug ?? "record"),
});

const recordEntityScope = () =>
	Effect.succeed({
		isBuiltin: false,
		entityName: "Sample",
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
	test.effect(
		"rejects clearing user state when the entity schema denies it",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(clear(EntityId.make("library-entity")));

				assertExitFails(
					exit,
					new EntityUserDataBadRequest({
						reason: { operation: "clear", code: "operation-denied" },
					}),
				);
			}),
		testTimeout,
	);
});

const changingScope = Layer.unwrap(
	Effect.sync(() => {
		let reads = 0;
		return makeServiceLayer({
			entitiesRepository: makeEntitiesRepository({ getEntityScopeForUser: recordEntityScope }),
			eventsRepository: makeEventsRepository({
				listUserDataEventReferences: (input) => {
					reads += 1;
					return Effect.succeed(
						eventReferencesFor(
							input,
							reads === 1
								? [EventId.make("first")]
								: [EventId.make("first"), EventId.make("concurrent")],
						),
					);
				},
			}),
		});
	}),
);

layer(changingScope)((test) => {
	test.effect(
		"rejects a concurrent scope addition before persisting a removal",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(clear(EntityId.make("entity-1")));
				assertExitFails(exit, new EntityUserDataBadRequest({ reason: { code: "state-conflict" } }));
			}),
		testTimeout,
	);
});

const retainedChildClear = makeServiceLayer({
	eventsRepository: makeEventsRepository({
		listUserDataEventReferences: () =>
			Effect.succeed([
				{
					id: EventId.make("history"),
					entityId: EntityId.make("old-part"),
					sessionEntityId: EntityId.make("entity-1"),
				},
			]),
	}),
	graphRepository: Layer.mock(EntityUserDataGraphRepository)({
		listChildren: () => Effect.succeed([]),
		listEvidence: ({ entityIds }) =>
			Effect.succeed(
				entityIds.includes(EntityId.make("old-part"))
					? [
							{
								id: EventId.make("evidence"),
								entityId: EntityId.make("ledger"),
								properties: { subjectId: "old-part" },
							},
						]
					: [],
			),
	}),
	entitiesRepository: makeEntitiesRepository({
		getEntityScopeForUser: recordEntityScope,
		getByIdsForUser: () =>
			Effect.succeed(
				new Map([
					[
						EntityId.make("old-part"),
						{
							providerId: null,
							externalId: null,
							populatedAt: null,
							name: "Retained part",
							properties: { number: 1 },
							entitySchemaPluginId: null,
							id: EntityId.make("old-part"),
							createdAt: "2026-01-01T00:00:00.000Z",
							updatedAt: "2026-01-01T00:00:00.000Z",
							entitySchemaSlug: EntitySchemaSlug.make("part"),
						},
					],
				]),
			),
	}),
	definitions: makeDefinitionsLayer([], {}, [null], {
		relationshipSchemas: [
			{
				slug: "parts",
				pluginId: null,
				name: { key: "test.parts" },
				targetEntitySchemaSlug: "part",
				sourceEntitySchemaSlug: "record",
				propertiesSchema: { fields: {} },
			},
		],
		entitySchemas: [
			{
				icon: "box",
				pluginId: null,
				slug: "record",
				name: { key: "test.record" },
				propertiesSchema: { fields: {} },
				eventSchemas: [
					{
						pluginId: null,
						slug: "evidence",
						name: { key: "test.evidence" },
						propertiesSchema: {
							fields: {
								subjectId: {
									type: "string",
									label: "Subject",
									description: "Subject",
									reference: { kind: "entity-id" },
								},
							},
						},
					},
				],
				userState: {
					deniedOperations: [],
					children: [{ path: ["parts"], entitySchemaSlug: "part", identityProperties: ["number"] }],
					evidence: [
						{
							subjectProperty: "subjectId",
							eventSchema: {
								owner: { kind: "self" },
								slug: EventSchemaSlug.make("evidence"),
								entitySchemaSlug: EntitySchemaSlug.make("record"),
							},
						},
					],
				},
			},
			{
				icon: "box",
				slug: "part",
				pluginId: null,
				eventSchemas: [],
				name: { key: "test.part" },
				propertiesSchema: {
					fields: { number: { type: "integer", label: "Number", description: "Number" } },
				},
			},
		],
	}),
});

layer(retainedChildClear)((test) => {
	test.effect(
		"clears detached session history and the detached child's own retained evidence",
		() =>
			Effect.gen(function* () {
				const cleared = yield* clear(EntityId.make("entity-1"));
				expect(cleared.result.deletedEventsCount).toBe(2);
				expect(cleared.events.map((change) => change.itemIdentity)).toEqual([
					"event:evidence:delete",
					"event:history:delete",
				]);
			}),
		testTimeout,
	);
});

layer(
	makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({ getEntityScopeForUser: recordEntityScope }),
		eventsRepository: makeEventsRepository({
			listUserDataEventReferences: (input) =>
				Effect.succeed(
					eventReferencesFor(input, [EventId.make("event-1"), EventId.make("event-2")]),
				),
		}),
	}),
)((test) => {
	test.effect(
		"plans deletes of the matching events for the change set when clearing user state",
		() =>
			Effect.gen(function* () {
				const cleared = yield* clear(EntityId.make("entity-1"));

				expect(cleared.result).toEqual<unknown>({
					deletedEventsCount: 2,
					deletedRelationshipsCount: 0,
					entityId: EntityId.make("entity-1"),
				});
				expect(cleared.events).toEqual<unknown>(
					["event-1", "event-2"].map((eventId) => ({
						eventId,
						kind: "delete",
						kernelCollection: true,
						itemIdentity: `event:${eventId}:delete`,
					})),
				);
			}),
		testTimeout,
	);
});

const snapshotFields = {
	properties: {},
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};
const deletePlan = (id: string, resource: "event" | "relationship"): Effect.Effect<LifecyclePlan> =>
	Schema.decodeUnknownEffect(AutomationTrigger)({
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
							eventSchemaPluginId: null,
							entitySchemaSlug: "record",
							entitySchemaPluginId: null,
							eventSchemaSlug: "progress",
							occurredAt: "2026-01-01T00:00:00.000Z",
						}
					: {
							...snapshotFields,
							id,
							sourceEntityId: "entity-1",
							targetEntityId: "target-1",
							relationshipSchemaPluginId: null,
							relationshipSchemaSlug: "relationship-schema",
						},
		},
	}).pipe(
		Effect.orDie,
		Effect.map((trigger) => ({ trigger, runs: [], wasCreated: true })),
	);

const relationshipPlan = deletePlan("relationship-trigger", "relationship");

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
			listUserDataEventReferences: (input) =>
				Effect.succeed(
					eventReferencesFor(input, [EventId.make("event-1"), EventId.make("event-2")]),
				),
		}),
		relationshipsService: makeRelationshipsService({
			prepareUserDelete: () =>
				call("prepare:relationship").pipe(Effect.as(preparedRelationshipDelete)),
			persistPrepared: () =>
				Effect.gen(function* () {
					expect(yield* session.isTransactionActive).toBe(true);
					yield* call("persist:relationship");
					return {
						result: persistedRelationship,
						dispatch: [toLifecycleDispatchPlan(yield* relationshipPlan)],
					};
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listUserRelationshipsForEntitiesWithProvenance: () =>
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
		planner: Layer.mock(LifecyclePlanner)({
			plan: () => Effect.die("unused"),
			prepareBatch: () => Effect.succeed({ id: "prepared", hasCandidates: true }),
			planBatch: (input) =>
				Effect.gen(function* () {
					const persisted = callsOf(yield* recorded).filter(
						(value) => value === "persist:relationship",
					).length;
					const changes = [yield* relationshipPlan].slice(0, persisted).flatMap(({ trigger }) => {
						const payload = trigger.payload;
						return payload?.category === "change" &&
							payload.operation !== "batch" &&
							payload.resource === input.resource
							? [{ payload, scopeUserId: trigger.scopeUserId }]
							: [];
					});
					return yield* Effect.forEach(
						yield* lifecycleBatchTriggers(input, 200, changes),
						(trigger) =>
							record({ trigger, kind: "batch" }).pipe(
								Effect.as(toLifecycleDispatchPlan({ trigger, runs: [], wasCreated: true })),
							),
					);
				}),
		}),
	};
});

layer(clearPhases.layer)((test) => {
	test.effect(
		"prepares every clear change before one relationship persistence phase",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const cleared = yield* clear(EntityId.make("entity-1"));
				expect(yield* session.isTransactionActive).toBe(false);

				const observations = yield* clearPhases.recorded;
				const batches = observations.flatMap((observation) =>
					observation.kind === "batch" ? [observation.trigger] : [],
				);
				expect(
					batches.map(({ payload }) =>
						payload?.operation === "batch" ? [payload.resource, payload.items.length] : null,
					),
				).toEqual([["relationship", 1]]);
				expect(callsOf(observations)).toEqual(["prepare:relationship", "persist:relationship"]);
				expect(cleared.events).toHaveLength(2);
				expect(cleared.dispatch.map(({ triggerId }) => triggerId)).toEqual<unknown>([
					"relationship-trigger",
					...batches.map(({ id }) => id),
				]);
			}),
		testTimeout,
	);
});

const failedPreparation = recordingServiceLayer<string>(({ record }) => ({
	entitiesRepository: makeEntitiesRepository({ getEntityScopeForUser: recordEntityScope }),
	eventsRepository: makeEventsRepository({ listUserDataEventReferences: () => Effect.succeed([]) }),
	relationshipsService: makeRelationshipsService({
		persistPrepared: () =>
			record("persist").pipe(Effect.as({ dispatch: [], result: persistedRelationship })),
		prepareUserDelete: (input) =>
			record(`prepare:${input.targetEntityId}`).pipe(
				Effect.andThen(
					input.targetEntityId === "target-relationship-1"
						? Effect.succeed(preparedRelationshipDelete)
						: Effect.fail(
								new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } }),
							),
				),
			),
	}),
	relationshipsRepository: makeRelationshipsRepository({
		listUserRelationshipsForEntitiesWithProvenance: () =>
			Effect.succeed(
				["relationship-1", "relationship-2"].map((id) => ({
					properties: {},
					id: RelationshipId.make(id),
					relationshipSchemaPluginId: null,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					sourceEntityId: EntityId.make("entity-1"),
					targetEntityId: EntityId.make(`target-${id}`),
					relationshipSchemaSlug: RelationshipSchemaSlug.make("relationship-schema"),
				})),
			),
	}),
}));

layer(failedPreparation.layer)((test) => {
	test.effect(
		"does not persist any clear change when preparation fails",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(clear(EntityId.make("entity-1")));

				assertExitFails(
					exit,
					new EntityUserDataBadRequest({ reason: { code: "relationship-merge-failed" } }),
				);
				expect(yield* failedPreparation.recorded).toEqual([
					"prepare:target-relationship-1",
					"prepare:target-relationship-2",
				]);
			}),
		testTimeout,
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"rejects merging an entity into itself",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					merge({ mergeFrom: EntityId.make("entity-id"), mergeInto: EntityId.make("entity-id") }),
				);

				assertExitFails(
					exit,
					new EntityUserDataBadRequest({ reason: { code: "same-entity-merge" } }),
				);
			}),
		testTimeout,
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
	test.effect(
		"returns not found when one merge entity is not visible",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					merge({ mergeFrom: EntityId.make("from"), mergeInto: EntityId.make("into") }),
				);

				assertExitFails(
					exit,
					new EntityUserDataNotFound({
						reason: {
							code: "entity-not-found",
							entityIds: [EntityId.make("from"), EntityId.make("into")],
						},
					}),
				);
			}),
		testTimeout,
	);
});

const differentOwnerMerge = recordingServiceLayer<string>(({ record }) => ({
	definitions: makeDefinitionsLayer([], {}, [null, "other-plugin"]),
	eventsRepository: makeEventsRepository({
		listUserDataEventReferences: () => record("list-events").pipe(Effect.as([])),
	}),
	relationshipsRepository: makeRelationshipsRepository({
		listUserRelationshipsForEntitiesWithProvenance: () => Effect.succeed([]),
	}),
	entitiesRepository: makeEntitiesRepository({
		getEntityMergeScopeForUser: ({ entityId }) =>
			Effect.succeed(
				makeMergeScope({
					entityId,
					entitySchemaPluginId: entityId === "from" ? null : "other-plugin",
				}),
			),
	}),
}));

layer(differentOwnerMerge.layer)((test) => {
	test.effect(
		"rejects merging equal schema slugs owned by different plugins before dispatch",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					merge({ mergeFrom: EntityId.make("from"), mergeInto: EntityId.make("into") }),
				);

				assertExitFails(
					exit,
					new EntityUserDataBadRequest({ reason: { code: "entity-schema-mismatch" } }),
				);
				expect(yield* differentOwnerMerge.recorded).toEqual([]);
			}),
		testTimeout,
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
	test.effect(
		"rejects merging when either source or destination schema denies it",
		() =>
			Effect.gen(function* () {
				const sourceDenied = yield* Effect.exit(
					merge({
						mergeFrom: EntityId.make("blocked-source"),
						mergeInto: EntityId.make("allowed-destination"),
					}),
				);
				const destinationDenied = yield* Effect.exit(
					merge({
						mergeFrom: EntityId.make("allowed-source"),
						mergeInto: EntityId.make("blocked-destination"),
					}),
				);

				const expected = new EntityUserDataBadRequest({
					reason: { operation: "merge", code: "operation-denied" },
				});
				assertExitFails(sourceDenied, expected);
				assertExitFails(destinationDenied, expected);
			}),
		testTimeout,
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
	test.effect(
		"rejects merging entities from different schemas",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					merge({ mergeFrom: EntityId.make("from"), mergeInto: EntityId.make("into") }),
				);

				assertExitFails(
					exit,
					new EntityUserDataBadRequest({ reason: { code: "entity-schema-mismatch" } }),
				);
			}),
		testTimeout,
	);
});

layer(
	makeServiceLayer({
		definitions: makeDefinitionsLayer(["kind"]),
		eventsRepository: makeEventsRepository({
			listUserDataEventReferences: () => Effect.succeed([]),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listUserRelationshipsForEntitiesWithProvenance: () => Effect.succeed([]),
		}),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(makeMergeScope({ entityId, properties: { kind: "novel" } })),
		}),
	}),
)((test) => {
	test.effect(
		"allows merging entities with matching declared identity properties",
		() =>
			Effect.gen(function* () {
				const merged = yield* merge({
					mergeFrom: EntityId.make("from"),
					mergeInto: EntityId.make("into"),
				});

				expect(merged.result).toEqual<unknown>({
					mergeFrom: "from",
					mergeInto: "into",
					movedEventsCount: 0,
					movedRelationshipsCount: 0,
				});
			}),
		testTimeout,
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
	test.effect(
		"rejects merging entities with mismatched declared identity properties",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					merge({ mergeFrom: EntityId.make("from"), mergeInto: EntityId.make("into") }),
				);

				assertExitFails(
					exit,
					new EntityUserDataBadRequest({
						reason: { property: "kind", code: "identity-property-mismatch" },
					}),
				);
			}),
		testTimeout,
	);
});

const mergeMoves = recordingServiceLayer<string>(({ record }) => ({
	entitiesRepository: makeEntitiesRepository({
		getEntityMergeScopeForUser: ({ entityId }) => Effect.succeed(makeMergeScope({ entityId })),
	}),
	eventsRepository: makeEventsRepository({
		listUserDataEventReferences: (input) =>
			Effect.succeed(eventReferencesFor(input, [EventId.make("event-1"), EventId.make("event-2")])),
	}),
	relationshipsService: makeRelationshipsService({
		prepareUserWrite: (input, item) =>
			record(
				`prepare:${input.sourceEntityId}->${input.targetEntityId}:create:${item.itemIdentity}`,
			).pipe(Effect.as(preparedRelationshipCreate)),
		prepareUserDelete: (input, item) =>
			record(
				`prepare:${input.sourceEntityId}->${input.targetEntityId}:delete:${item.itemIdentity}`,
			).pipe(Effect.as(preparedRelationshipDelete)),
		persistPrepared: (prepared) =>
			record(
				prepared === preparedRelationshipCreate
					? "persist:relationship:create"
					: "persist:relationship:delete",
			).pipe(Effect.as({ dispatch: [], result: persistedRelationship })),
	}),
	relationshipsRepository: makeRelationshipsRepository({
		listUserRelationshipsForEntitiesWithProvenance: () =>
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
	test.effect(
		"moves events and relationships when the schema has no merge identity metadata",
		() =>
			Effect.gen(function* () {
				const merged = yield* merge({
					mergeFrom: EntityId.make("from"),
					mergeInto: EntityId.make("into"),
				});

				expect(merged.result).toEqual<unknown>({
					mergeFrom: "from",
					mergeInto: "into",
					movedEventsCount: 2,
					movedRelationshipsCount: 3,
				});
				expect(merged.events).toEqual<unknown>(
					["event-1", "event-2"].map((eventId) => ({
						eventId,
						kind: "move",
						mergeFrom: "from",
						mergeInto: "into",
						kernelCollection: true,
						itemIdentity: `event:${eventId}:update`,
					})),
				);
				expect(yield* mergeMoves.recorded).toEqual([
					"prepare:into->target-1:create:entity-user-data:relationship:relationship-1:create",
					"prepare:from->target-1:delete:entity-user-data:relationship:relationship-1:delete",
					"prepare:target-2->into:create:entity-user-data:relationship:relationship-2:create",
					"prepare:target-2->from:delete:entity-user-data:relationship:relationship-2:delete",
					"prepare:from->from:delete:entity-user-data:relationship:relationship-3:delete",
					"persist:relationship:create",
					"persist:relationship:delete",
					"persist:relationship:create",
					"persist:relationship:delete",
					"persist:relationship:delete",
				]);
			}),
		testTimeout,
	);
});

const mergeFrom = EntityId.make("from");
const mergeInto = EntityId.make("into");

layer(
	makeServiceLayer({
		eventsRepository: makeEventsRepository({
			listUserDataEventReferences: () => Effect.succeed([]),
		}),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) => Effect.succeed(makeMergeScope({ entityId })),
		}),
		relationshipsService: makeRelationshipsService({
			prepareUserWrite: () =>
				new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } }),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listUserRelationshipsForEntitiesWithProvenance: () =>
				Effect.succeed([
					{
						properties: {},
						sourceEntityId: mergeFrom,
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
						targetEntityId: EntityId.make("target"),
						id: RelationshipId.make("relationship-1"),
						relationshipSchemaPluginId: PluginId.make("inactive-plugin"),
						relationshipSchemaSlug: RelationshipSchemaSlug.make("inactive"),
					},
				]),
		}),
	}),
)((test) => {
	test.effect(
		"returns a typed entity-user-data failure when the relationship schema is inactive",
		() =>
			Effect.gen(function* () {
				assertExitFails(
					yield* Effect.exit(merge({ mergeFrom, mergeInto })),
					new EntityUserDataBadRequest({ reason: { code: "relationship-merge-failed" } }),
				);
			}),
		testTimeout,
	);
});

const pluginRevision = makeUserPluginRevision({
	ownerId: user.id,
	compiledHashes: {},
	slug: "merge-plugin",
});
const pluginPrincipal = makeUserPrincipal({ pluginRevision, subject: makeUserSubject(user.id) });
const pluginCommand = {
	...command,
	writeContext: pluginPrincipal,
	kernelCollection: true as const,
};
const pluginMergeScope = (
	entityId: EntityId,
	overrides: { entityUserId?: null | UserId } = {},
) => ({
	...makeMergeScope({
		entityId,
		entitySchemaSlug: "record",
		entitySchemaPluginId: pluginRevision.id,
	}),
	...overrides,
});
const pluginSchema = {
	slug: EntitySchemaSlug.make("record"),
	owner: definitionOwner(pluginRevision.id),
};

const commandRecordings = recordingServiceLayer<DomainLifecycleCommand>(({ record }) => ({
	definitions: makeDefinitionsLayer([], {}, [pluginRevision.id]),
	entitiesRepository: makeEntitiesRepository({
		getEntityMergeScopeForUser: ({ entityId }) => Effect.succeed(pluginMergeScope(entityId)),
	}),
	eventsRepository: makeEventsRepository({
		listUserDataEventReferences: (input) =>
			Effect.succeed(eventReferencesFor(input, [EventId.make("event-1")])),
	}),
	relationshipsService: makeRelationshipsService({
		persistPrepared: () => Effect.succeed({ dispatch: [], result: persistedRelationship }),
		prepareUserWrite: (_input, item) => record(item).pipe(Effect.as(preparedRelationshipCreate)),
		prepareUserDelete: (_input, item) => record(item).pipe(Effect.as(preparedRelationshipDelete)),
	}),
	relationshipsRepository: makeRelationshipsRepository({
		listUserRelationshipsForEntitiesWithProvenance: () =>
			Effect.succeed([
				{
					properties: {},
					sourceEntityId: mergeFrom,
					relationshipSchemaPluginId: null,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					targetEntityId: EntityId.make("target"),
					id: RelationshipId.make("relationship-1"),
					relationshipSchemaSlug: RelationshipSchemaSlug.make("relationship-schema"),
				},
			]),
	}),
}));

layer(commandRecordings.layer)((test) => {
	test.effect(
		"keeps the plugin write context and kernel collection flag for script merges",
		() =>
			Effect.gen(function* () {
				const merged = yield* merge({ mergeFrom, mergeInto }, pluginCommand, pluginSchema);

				const recorded = (yield* commandRecordings.recorded).at(-1);
				expect(recorded?.writeContext).toBe(pluginPrincipal);
				expect(recorded?.kernelCollection).toBe(true);
				expect(merged.events).toMatchObject([{ kind: "move", kernelCollection: true }]);
			}),
		testTimeout,
	);
});

const scriptMergeRefusals = recordingServiceLayer<string>(({ record }) => ({
	definitions: makeDefinitionsLayer([], { record: ["merge"] }, [pluginRevision.id]),
	eventsRepository: makeEventsRepository({
		listUserDataEventReferences: () => record("list-events").pipe(Effect.as([])),
	}),
	entitiesRepository: makeEntitiesRepository({
		getEntityMergeScopeForUser: ({ entityId }) => Effect.succeed(pluginMergeScope(entityId)),
	}),
}));

layer(scriptMergeRefusals.layer)((test) => {
	test.effect(
		"refuses script merges when the schema denies merge",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					merge({ mergeFrom, mergeInto }, pluginCommand, pluginSchema),
				);

				assertExitFails(
					exit,
					new EntityUserDataBadRequest({
						reason: { operation: "merge", code: "operation-denied" },
					}),
				);
				expect(yield* scriptMergeRefusals.recorded).toEqual([]);
			}),
		testTimeout,
	);
});
