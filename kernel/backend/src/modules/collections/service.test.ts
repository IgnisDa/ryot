import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import { CollectionBadRequest } from "@ryot-app/contract/modules/collections/schemas";
import type { CreateEventsResponse } from "@ryot-app/contract/modules/events/schemas";
import {
	AutomationExecutionId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand, type LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { assertExitFails } from "#lib/test-utils/assertions";
import {
	databaseLayer,
	makeWorkflowActivityEngine,
	type MockOverrides,
} from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { AddEntityToCollectionWorkflow } from "./add-entity-to-collection-workflow";
import {
	AddEntityToCollectionWorkflowOperationsLive,
	runAddEntityToCollectionWorkflow,
} from "./add-entity-to-collection-workflow-live";
import { CollectionsRepository } from "./repository";
import { CollectionsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";
const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { language: null, disableIntegrations: false },
};
const collectionId = EntityId.make("collection-id");
const entityId = EntityId.make("entity-id");
const relationshipId = RelationshipId.make("relationship-id");
const warning = {
	omittedHooks: [],
	hasRequiredHooks: false,
	code: "automation-limit-reached",
	triggerId: AutomationTriggerId.make("trigger-id"),
} as const satisfies AutomationWarning;
const collectionEntity = {
	createdAt: now,
	updatedAt: now,
	properties: {},
	id: collectionId,
	externalId: null,
	providerId: null,
	name: "Favorites",
	populatedAt: null,
	entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
};
const membership = {
	createdAt: now,
	properties: {},
	wasInserted: true,
	id: relationshipId,
	sourceEntityId: entityId,
	targetEntityId: collectionId,
	relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of-schema-id"),
};
const memberOfSchema = {
	isBuiltin: true,
	slug: "member-of",
	name: "Member Of",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	id: RelationshipSchemaSlug.make("member-of-schema-id"),
	propertiesSchema: { fields: {}, unknownKeys: "passthrough" as const },
};
const collectionPropertiesSchema = {
	fields: {
		description: { label: "Description", type: "string" as const, description: "Description" },
		membershipPropertiesSchema: {
			properties: {},
			type: "object" as const,
			unknownKeys: "passthrough" as const,
			label: "Membership Properties Schema",
			description: "Membership Properties Schema",
		},
	},
} satisfies AppSchema;
const collectionEntitySchema = {
	propertiesSchema: collectionPropertiesSchema,
	id: EntitySchemaSlug.make("collection-schema-id"),
	entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
};
const addEventSchema = {
	name: "Add Entity to Collection",
	slug: "add-entity-to-collection",
	propertiesSchema: { fields: {} },
	id: EventSchemaSlug.make("add-event-schema-id"),
};
const removeEventSchema = {
	propertiesSchema: { fields: {} },
	name: "Remove Entity from Collection",
	slug: "remove-entity-from-collection",
	id: EventSchemaSlug.make("remove-event-schema-id"),
};

const membershipPlan = {
	runs: [],
	blockedReason: null,
	triggerId: AutomationTriggerId.make("membership-trigger"),
};
const committedRelationship = {
	_tag: "Committed" as const,
	dispatch: [membershipPlan],
	result: { relationship: { ...membership, updatedAt: now } },
};

const mockCollections = Layer.mock(CollectionsRepository);
const mockEntities = Layer.mock(EntitiesService);
const mockEvents = Layer.mock(EventsService);
const mockRelationships = Layer.mock(RelationshipsService);
const mockRelationshipSchemas = Layer.mock(RelationshipSchemasRepository);

type EntityCreateInput = Parameters<EntitiesService["Service"]["create"]>[0];
type WorkflowDispatch = { readonly executionId: string; readonly payload: unknown };

class CollectionCalls extends Context.Service<
	CollectionCalls,
	{
		readonly createdEntities: Effect.Effect<ReadonlyArray<EntityCreateInput>>;
		readonly workflowDispatches: Effect.Effect<ReadonlyArray<WorkflowDispatch>>;
		readonly lifecycleCommands: Effect.Effect<Readonly<Record<string, LifecycleCommand>>>;
		readonly dispatchedTriggers: Effect.Effect<ReadonlyArray<ReadonlyArray<AutomationTriggerId>>>;
	}
>()("test/CollectionCalls") {}

const addWorkflowExecutionId = "add-workflow-execution-id";

const makeServiceLayer = (
	options: {
		readonly entities?: MockOverrides<typeof mockEntities>;
		readonly events?: MockOverrides<typeof mockEvents>;
		readonly relationships?: MockOverrides<typeof mockRelationships>;
		readonly collections?: MockOverrides<typeof mockCollections>;
		readonly workflow?: {
			readonly eventFailure?: unknown;
			readonly eventResult?: CreateEventsResponse;
			readonly warnings?: ReadonlyArray<AutomationWarning>;
		};
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const createdEntities = yield* Ref.make<ReadonlyArray<EntityCreateInput>>([]);
			const workflowDispatches = yield* Ref.make<ReadonlyArray<WorkflowDispatch>>([]);
			const lifecycleCommands = yield* Ref.make<Readonly<Record<string, LifecycleCommand>>>({});
			const dispatchedTriggers = yield* Ref.make<ReadonlyArray<ReadonlyArray<AutomationTriggerId>>>(
				[],
			);
			const recordCommand = (operation: string, command: LifecycleCommand) =>
				Ref.update(lifecycleCommands, (all) => ({ ...all, [operation]: command }));
			const entities = {
				create: () => Effect.succeed({ warnings: [], entity: collectionEntity }),
				...options.entities,
			};
			const events = {
				create: () => Effect.succeed({ count: 1, warnings: [], outcomes: [], failure: null }),
				...options.events,
			};
			const relationships = {
				prepareCreate: () => Effect.succeed(committedRelationship),
				create: () => Effect.succeed({ warnings: [], relationship: membership }),
				delete: () => Effect.succeed({ warnings: [], relationship: membership }),
				prepareDeleteUserRelationshipById: () => Effect.succeed(committedRelationship),
				deleteUserRelationshipById: () =>
					Effect.succeed({ warnings: [], relationship: membership }),
				...options.relationships,
			};
			const workflow = options.workflow ?? {};
			const instance = WorkflowInstance.initial(
				AddEntityToCollectionWorkflow,
				addWorkflowExecutionId,
			);
			const engine = makeWorkflowActivityEngine(instance, {
				execute: (_workflow, execution) =>
					Ref.update(workflowDispatches, (all) => [
						...all,
						{ payload: execution.payload, executionId: execution.executionId },
					]).pipe(
						Effect.andThen(
							workflow.eventFailure
								? Effect.fail(workflow.eventFailure)
								: Effect.succeed(
										workflow.eventResult ?? { count: 1, warnings: [], outcomes: [], failure: null },
									),
						),
					),
			});
			const dependencies = Layer.mergeAll(
				Layer.mock(LifecyclePlanner)({ plan: () => Effect.die("unused") }),
				Layer.mock(LifecycleExecution)({
					after: () => Effect.die("unused"),
					executePolicy: () => Effect.die("unused"),
					skipQueuedPolicies: () => Effect.die("unused"),
					dispatch: (plans) =>
						Ref.update(dispatchedTriggers, (all) => [
							...all,
							plans.map(({ triggerId }) => triggerId),
						]).pipe(Effect.as(plans.length > 0 ? (workflow.warnings ?? []) : [])),
				}),
				Layer.mock(EntitiesRepository)({}),
				mockEntities({
					...entities,
					create: (input) =>
						Ref.update(createdEntities, (all) => [...all, input]).pipe(
							Effect.andThen(entities.create(input)),
						),
				}),
				mockEvents({
					...events,
					create: (input, lifecycle) =>
						recordCommand("events.create", lifecycle).pipe(
							Effect.andThen(events.create(input, lifecycle)),
						),
				}),
				mockRelationships({
					...relationships,
					delete: (input, lifecycle) =>
						recordCommand("relationships.delete", lifecycle).pipe(
							Effect.andThen(relationships.delete(input, lifecycle)),
						),
					prepareCreate: (input, lifecycle) =>
						recordCommand("relationships.prepareCreate", lifecycle).pipe(
							Effect.andThen(relationships.prepareCreate(input, lifecycle)),
						),
					prepareDeleteUserRelationshipById: (userId, id, lifecycle) =>
						recordCommand("relationships.prepareDeleteUserRelationshipById", lifecycle).pipe(
							Effect.andThen(
								relationships.prepareDeleteUserRelationshipById(userId, id, lifecycle),
							),
						),
				}),
				mockCollections({
					findCollectionByNameForUser: () => Effect.succeed(null),
					getCollectionById: () => Effect.succeed(collectionEntity),
					getBuiltinCollectionSchema: () => Effect.succeed(collectionEntitySchema),
					getEntityForMembership: () =>
						Effect.succeed({ id: entityId, userId: user.id, entitySchemaSlug: "record" }),
					findBuiltinEventSchemaBySlug: (_entitySchemaSlug, slug) =>
						Effect.succeed(
							slug === "add-entity-to-collection" ? addEventSchema : removeEventSchema,
						),
					...options.collections,
				}),
				mockRelationshipSchemas({ findBuiltinBySlug: () => Effect.succeed(memberOfSchema) }),
				Layer.succeed(WorkflowEngine, engine),
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(CollectionCalls, {
					createdEntities: Ref.get(createdEntities),
					lifecycleCommands: Ref.get(lifecycleCommands),
					workflowDispatches: Ref.get(workflowDispatches),
					dispatchedTriggers: Ref.get(dispatchedTriggers),
				}),
			);
			return AddEntityToCollectionWorkflowOperationsLive.pipe(
				Layer.provideMerge(CollectionsService.layer),
				Layer.provideMerge(dependencies),
				Layer.provideMerge(databaseLayer),
			);
		}),
	);

const command = (executionId: string): LifecycleCommand =>
	rootLifecycleCommand({
		source: "api",
		occurredAt: now,
		initiator: { id: user.id, kind: "user" },
		itemIdentity: "collection:add-membership",
		executionId: AutomationExecutionId.make(executionId),
	});

const runAddWorkflow = runAddEntityToCollectionWorkflow(
	{
		entityId,
		collectionId,
		userId: user.id,
		executionId: addWorkflowExecutionId,
		command: command(addWorkflowExecutionId),
	},
	addWorkflowExecutionId,
);

layer(makeServiceLayer())((test) => {
	test.effect("rejects creating a collection with an empty name", () =>
		Effect.gen(function* () {
			const service = yield* CollectionsService;
			const exit = yield* Effect.exit(service.create(user, { name: "  " }));
			assertExitFails(
				exit,
				new CollectionBadRequest({ reason: { field: "name", code: "name-required" } }),
			);
		}),
	);
});

layer(
	makeServiceLayer({
		entities: { create: () => Effect.succeed({ warnings: [warning], entity: collectionEntity }) },
	}),
)((test) => {
	test.effect("creates a collection with one API root command and propagates warnings", () =>
		Effect.gen(function* () {
			const result = yield* (yield* CollectionsService).create(user, { name: "Favorites" });
			const [input] = yield* (yield* CollectionCalls).createdEntities;
			const { populatedAt: _populatedAt, ...expected } = collectionEntity;
			expect(result).toEqual({ ...expected, warnings: [warning] });
			expect(input?.lifecycle.causation).toMatchObject({
				depth: 0,
				source: "api",
				initiator: { id: user.id, kind: "user" },
			});
			expect(input?.lifecycle.itemIdentity).toBe("collection:create");
		}),
	);
});

const eventWarning = { ...warning, triggerId: AutomationTriggerId.make("event-trigger") };

layer(
	makeServiceLayer({
		workflow: {
			warnings: [warning],
			eventResult: { count: 1, outcomes: [], failure: null, warnings: [eventWarning] },
		},
	}),
)((test) => {
	test.effect("propagates membership and event warnings with a derived event identity", () =>
		Effect.gen(function* () {
			const calls = yield* CollectionCalls;
			const result = yield* runAddWorkflow;
			const membershipCommand = (yield* calls.lifecycleCommands)["relationships.prepareCreate"];
			expect(result.warnings).toEqual([warning, eventWarning]);
			expect(yield* calls.dispatchedTriggers).toEqual([[membershipPlan.triggerId]]);
			const [dispatch] = yield* calls.workflowDispatches;
			if (!dispatch) {
				throw new Error("Expected an event workflow dispatch");
			}
			expect(dispatch.executionId).toBe("collection-membership-added-relationship-id");
			expect(dispatch.payload).toMatchObject({
				command: {
					causation: membershipCommand?.causation,
					occurredAt: membershipCommand?.occurredAt,
					itemIdentity: stableStringify(["collection:add-membership", "event:relationship-id"]),
				},
			});
		}),
	);
});

layer(makeServiceLayer({ workflow: { eventFailure: new Error("failed") } }))((test) => {
	test.effect("compensates with a stable identity derived from the original lifecycle fact", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runAddWorkflow);
			assertExitFails(
				exit,
				new CollectionBadRequest({ reason: { code: "membership-event-failed" } }),
			);
			const commands = yield* (yield* CollectionCalls).lifecycleCommands;
			expect(commands["relationships.prepareDeleteUserRelationshipById"]).toMatchObject({
				occurredAt: now,
				itemIdentity: stableStringify([
					"collection:add-membership",
					"compensation:relationship-id",
				]),
				causation: {
					executionId: "add-workflow-execution-id",
					rootExecutionId: "add-workflow-execution-id",
				},
			});
		}),
	);
});

layer(
	makeServiceLayer({
		relationships: {
			delete: () => Effect.succeed({ warnings: [warning], relationship: membership }),
		},
		events: {
			create: () =>
				Effect.succeed({ count: 1, outcomes: [], failure: null, warnings: [eventWarning] }),
		},
	}),
)((test) => {
	test.effect("unwraps deletion results and combines relationship and event warnings", () =>
		Effect.gen(function* () {
			const result = yield* (yield* CollectionsService).removeFromCollection(user, {
				entityId,
				collectionId,
			});
			const commands = yield* (yield* CollectionCalls).lifecycleCommands;
			const relationshipCommand = commands["relationships.delete"];
			const eventCommand = commands["events.create"];
			expect(result).toEqual({
				warnings: [warning, eventWarning],
				memberOf: {
					createdAt: now,
					properties: {},
					id: relationshipId,
					sourceEntityId: entityId,
					targetEntityId: collectionId,
					relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of-schema-id"),
				},
			});
			expect(eventCommand?.causation).toEqual(relationshipCommand?.causation);
			expect(eventCommand?.occurredAt).toBe(relationshipCommand?.occurredAt);
			expect(eventCommand?.itemIdentity).toBe(
				stableStringify(["collection:remove-membership", "event:relationship-id"]),
			);
		}),
	);
});
