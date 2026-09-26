import { PgClient } from "@effect/sql-pg";
import { expect, it } from "@effect/vitest";
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
import { Effect, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand, type LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";
import {
	databaseLayer,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
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
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
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

const makeServiceLayer = (
	options: {
		readonly database?: Database["Service"];
		readonly entities?: MockOverrides<typeof mockEntities>;
		readonly events?: MockOverrides<typeof mockEvents>;
		readonly relationships?: MockOverrides<typeof mockRelationships>;
		readonly collections?: MockOverrides<typeof mockCollections>;
	} = {},
) => {
	const selectedDatabaseLayer = options.database
		? Layer.succeed(Database, options.database)
		: databaseLayer;
	const dependencies = Layer.mergeAll(
		selectedDatabaseLayer,
		Layer.succeed(PgClient.PgClient, Object.create(null)),
		Layer.mock(LifecyclePlanner)({ plan: () => Effect.die("unused") }),
		Layer.mock(LifecycleExecution)({
			after: () => Effect.die("unused"),
			executePolicy: () => Effect.die("unused"),
			skipQueuedPolicies: () => Effect.die("unused"),
		}),
		Layer.mock(EntitiesRepository)({}),
		mockEntities({
			create: () => Effect.succeed({ warnings: [], entity: collectionEntity }),
			...options.entities,
		}),
		mockEvents({
			create: () => Effect.succeed({ count: 1, warnings: [], outcomes: [], failure: null }),
			...options.events,
		}),
		mockRelationships({
			prepareCreate: () => Effect.succeed(committedRelationship),
			create: () => Effect.succeed({ warnings: [], relationship: membership }),
			delete: () => Effect.succeed({ warnings: [], relationship: membership }),
			prepareDeleteUserRelationshipById: () => Effect.succeed(committedRelationship),
			deleteUserRelationshipById: () => Effect.succeed({ warnings: [], relationship: membership }),
			...options.relationships,
		}),
		mockCollections({
			findCollectionByNameForUser: () => Effect.succeed(null),
			getCollectionById: () => Effect.succeed(collectionEntity),
			getBuiltinCollectionSchema: () => Effect.succeed(collectionEntitySchema),
			getEntityForMembership: () =>
				Effect.succeed({ id: entityId, userId: user.id, entitySchemaSlug: "record" }),
			findBuiltinEventSchemaBySlug: (_entitySchemaSlug, slug) =>
				Effect.succeed(slug === "add-entity-to-collection" ? addEventSchema : removeEventSchema),
			...options.collections,
		}),
		mockRelationshipSchemas({ findBuiltinBySlug: () => Effect.succeed(memberOfSchema) }),
		Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
	);
	return Layer.merge(
		selectedDatabaseLayer,
		CollectionsService.layer.pipe(Layer.provide(dependencies)),
	);
};

const command = (executionId: string): LifecycleCommand =>
	rootLifecycleCommand({
		source: "api",
		occurredAt: now,
		initiator: { id: user.id, kind: "user" },
		itemIdentity: "collection:add-membership",
		executionId: AutomationExecutionId.make(executionId),
	});

const runAddWorkflow = (input: {
	readonly layer: ReturnType<typeof makeServiceLayer>;
	readonly eventResult?: CreateEventsResponse;
	readonly eventFailure?: unknown;
	readonly warnings?: ReadonlyArray<AutomationWarning>;
	readonly dispatches?: Array<{ readonly executionId: string; readonly payload: unknown }>;
	readonly dispatched?: Array<ReadonlyArray<AutomationTriggerId>>;
}) => {
	const executionId = "add-workflow-execution-id";
	const instance = WorkflowInstance.initial(AddEntityToCollectionWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance, {
		execute: (_workflow, options) => {
			input.dispatches?.push({ payload: options.payload, executionId: options.executionId });
			return input.eventFailure
				? Effect.fail(input.eventFailure)
				: Effect.succeed(
						input.eventResult ?? { count: 1, warnings: [], outcomes: [], failure: null },
					);
		},
	});
	return runAddEntityToCollectionWorkflow(
		{ entityId, executionId, collectionId, userId: user.id, command: command(executionId) },
		executionId,
	).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(LifecycleExecution, {
			after: () => Effect.die("unused"),
			executePolicy: () => Effect.die("unused"),
			skipQueuedPolicies: () => Effect.die("unused"),
			dispatch: (plans) =>
				Effect.sync(() => {
					input.dispatched?.push(plans.map(({ triggerId }) => triggerId));
					return plans.length > 0 ? (input.warnings ?? []) : [];
				}),
		}),
		Effect.provide(
			Layer.merge(
				databaseLayer,
				AddEntityToCollectionWorkflowOperationsLive.pipe(Layer.provide(input.layer)),
			),
		),
	);
};

it.effect("rejects creating a collection with an empty name", () =>
	Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(service.create(user, { name: "  " }));
		assertExitFails(
			exit,
			new CollectionBadRequest({ reason: { field: "name", code: "name-required" } }),
		);
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("creates a collection with one API root command and propagates warnings", () => {
	let input: Parameters<EntitiesService["Service"]["create"]>[0] | undefined;
	const layer = makeServiceLayer({
		entities: {
			create: (value) =>
				Effect.sync(() => {
					input = value;
					return { warnings: [warning], entity: collectionEntity };
				}),
		},
	});
	return Effect.gen(function* () {
		const result = yield* (yield* CollectionsService).create(user, { name: "Favorites" });
		const { populatedAt: _populatedAt, ...expected } = collectionEntity;
		expect(result).toEqual({ ...expected, warnings: [warning] });
		expect(input?.lifecycle.causation).toMatchObject({
			depth: 0,
			source: "api",
			initiator: { id: user.id, kind: "user" },
		});
		expect(input?.lifecycle.itemIdentity).toBe("collection:create");
	}).pipe(Effect.provide(layer));
});

it.effect("does not wrap relationship lifecycle ownership in a collection transaction", () => {
	let transactions = 0;
	const database = Database.of(
		Object.assign(Object.create(null), {
			transaction: ((callback) => {
				transactions += 1;
				return callback(Object.create(null));
			}) satisfies Database["Service"]["transaction"],
		}),
	);
	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		yield* service.prepareMembership({
			entityId,
			collectionId,
			userId: user.id,
			command: command("membership"),
		});
		expect(transactions).toBe(0);
	}).pipe(Effect.provide(makeServiceLayer({ database })));
});

it.effect("propagates membership and event warnings with a derived event identity", () => {
	const dispatched: Array<ReadonlyArray<AutomationTriggerId>> = [];
	const dispatches: Array<{ readonly executionId: string; readonly payload: unknown }> = [];
	const relationshipWarnings = [warning];
	const eventWarning = { ...warning, triggerId: AutomationTriggerId.make("event-trigger") };
	let membershipCommand: LifecycleCommand | undefined;
	const layer = makeServiceLayer({
		relationships: {
			prepareCreate: (_input, lifecycle) =>
				Effect.sync(() => {
					membershipCommand = lifecycle;
					return committedRelationship;
				}),
		},
	});
	return Effect.gen(function* () {
		const result = yield* runAddWorkflow({
			layer,
			dispatches,
			dispatched,
			warnings: relationshipWarnings,
			eventResult: { count: 1, outcomes: [], failure: null, warnings: [eventWarning] },
		});
		expect(result.warnings).toEqual([warning, eventWarning]);
		expect(dispatched).toEqual([[membershipPlan.triggerId]]);
		const [dispatch] = dispatches;
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
	}).pipe(Effect.provide(layer));
});

it.effect("compensates with a stable identity derived from the original lifecycle fact", () => {
	let compensationCommand: LifecycleCommand | undefined;
	const layer = makeServiceLayer({
		relationships: {
			prepareDeleteUserRelationshipById: (_userId, _relationshipId, lifecycle) =>
				Effect.sync(() => {
					compensationCommand = lifecycle;
					return committedRelationship;
				}),
		},
	});
	return Effect.gen(function* () {
		const exit = yield* Effect.exit(runAddWorkflow({ layer, eventFailure: new Error("failed") }));
		assertExitFails(
			exit,
			new CollectionBadRequest({ reason: { code: "membership-event-failed" } }),
		);
		expect(compensationCommand).toMatchObject({
			occurredAt: now,
			itemIdentity: stableStringify(["collection:add-membership", "compensation:relationship-id"]),
			causation: {
				executionId: "add-workflow-execution-id",
				rootExecutionId: "add-workflow-execution-id",
			},
		});
	}).pipe(Effect.provide(layer));
});

it.effect("unwraps deletion results and combines relationship and event warnings", () => {
	let relationshipCommand: LifecycleCommand | undefined;
	let eventCommand: LifecycleCommand | undefined;
	const eventWarning = { ...warning, triggerId: AutomationTriggerId.make("event-trigger") };
	const layer = makeServiceLayer({
		relationships: {
			delete: (_input, lifecycle) =>
				Effect.sync(() => {
					relationshipCommand = lifecycle;
					return { warnings: [warning], relationship: membership };
				}),
		},
		events: {
			create: (_input, lifecycle) =>
				Effect.sync(() => {
					eventCommand = lifecycle;
					return { count: 1, outcomes: [], failure: null, warnings: [eventWarning] };
				}),
		},
	});
	return Effect.gen(function* () {
		const result = yield* (yield* CollectionsService).removeFromCollection(user, {
			entityId,
			collectionId,
		});
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
	}).pipe(Effect.provide(layer));
});
