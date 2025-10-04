import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { CurrentDb, DbRunner } from "~/lib/db";
import { CollectionsService } from "~/modules/collections/service";
import { EntitiesRepository } from "~/modules/entities/repository";
import { EntitySchemasRepository } from "~/modules/entity-schemas/repository";
import { EventSchemasRepository } from "~/modules/event-schemas/repository";
import { EventsService } from "~/modules/events/service";

import { ImportsRepository } from "./repository";
import { ProcessImportRunWorkflow } from "./worker";
import { runOneTimeMediaImportWorkflow } from "./workflows";

const now = "2026-06-17T00:00:00.000Z";

const dbRunnerLayer = Layer.succeed(DbRunner, <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const defaultImportsRepository = () =>
	Object.assign(Object.create(null), {
		updateRun: () => Effect.void,
		createFailure: () => Effect.void,
		_tag: "ImportsRepository" as const,
		createRun: () => Effect.die("unused"),
		getRunById: () => Effect.die("unused"),
		deleteRunById: () => Effect.die("unused"),
		listRunsByUser: () => Effect.die("unused"),
		listFailuresByRunId: () => Effect.die("unused"),
		listRunsByIntegrationId: () => Effect.die("unused"),
		hasActiveRunForIntegration: () => Effect.die("unused"),
		listRecentStatusesByIntegrationId: () => Effect.die("unused"),
	});

const defaultEntitiesRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "EntitiesRepository" as const,
		createEntity: () => Effect.die("unused"),
		getByIdForUser: () => Effect.die("unused"),
		getEntityScopeById: () => Effect.die("unused"),
		insertRelationship: () => Effect.die("unused"),
		upsertRelationship: () => Effect.die("unused"),
		findEntitySchemaById: () => Effect.die("unused"),
		getEntityScopeForUser: () => Effect.die("unused"),
		upsertEntityRelationship: () => Effect.die("unused"),
		deleteUserEventsForEntity: () => Effect.die("unused"),
		createOrUpdateGlobalEntity: () => Effect.die("unused"),
		findRelationshipProperties: () => Effect.die("unused"),
		listMatchCandidatesBySchema: () => Effect.die("unused"),
		getEntitySchemaScopeForUser: () => Effect.die("unused"),
		findEntitySchemaScriptBySlug: () => Effect.succeed(null),
		findGlobalEntityByExternalId: () => Effect.die("unused"),
		findEntityByExternalIdForUser: () => Effect.die("unused"),
		deleteUserRelationshipsForEntity: () => Effect.die("unused"),
	});

const defaultCollectionsService = () =>
	Object.assign(Object.create(null), {
		_tag: "CollectionsService" as const,
		create: () => Effect.die("unused"),
		markEntityOwnedInLibrary: () => Effect.void,
		removeFromCollection: () => Effect.die("unused"),
		ensureEntityInLibrary: () => Effect.die("unused"),
		ensureLibraryEntityForUser: () => Effect.die("unused"),
		getOrCreateCollection: () =>
			Effect.succeed({
				createdAt: now,
				updatedAt: now,
				properties: {},
				id: "collection-1",
				name: "Collection",
				entitySchemaId: "schema-collection",
			}),
		addToCollection: () =>
			Effect.succeed({
				memberOf: {
					createdAt: now,
					properties: {},
					id: "membership-1",
					sourceEntityId: "entity-1",
					targetEntityId: "collection-1",
					relationshipSchemaId: "relationship-1",
				},
			}),
	});

const defaultEventsService = () =>
	Object.assign(Object.create(null), {
		_tag: "EventsService" as const,
		list: () => Effect.die("unused"),
		create: () => Effect.die("unused"),
		createForIntegration: () => Effect.die("unused"),
		createForImport: () => Effect.succeed({ count: 1 }),
	});

const defaultEventSchemasRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "EventSchemasRepository" as const,
		listForUser: () => Effect.die("unused"),
		getScopeForUser: () => Effect.die("unused"),
		createEventSchema: () => Effect.die("unused"),
		updateEventSchema: () => Effect.die("unused"),
		deleteEventSchema: () => Effect.die("unused"),
		getEntitySchemaScopeById: () => Effect.die("unused"),
		getBuiltinBySlug: () => Effect.succeed({ id: "event-schema-1" }),
	});

const defaultEntitySchemasRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "EntitySchemasRepository" as const,
		listByUser: () => Effect.die("unused"),
		findBySlug: () => Effect.die("unused"),
		getByIdForUser: () => Effect.die("unused"),
		createEntitySchema: () => Effect.die("unused"),
		updateEntitySchema: () => Effect.die("unused"),
		deleteEntitySchema: () => Effect.die("unused"),
		getBuiltinBySlug: () => Effect.succeed({ id: "builtin-book-schema" }),
	});

const makeImportsRepository = (overrides: Partial<ImportsRepository> = {}) =>
	Object.assign(Object.create(null), defaultImportsRepository(), overrides);

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	Object.assign(Object.create(null), defaultEntitiesRepository(), overrides);

const makeCollectionsService = (overrides: Partial<CollectionsService> = {}) =>
	Object.assign(Object.create(null), defaultCollectionsService(), overrides);

const makeEventsService = (overrides: Partial<EventsService> = {}) =>
	Object.assign(Object.create(null), defaultEventsService(), overrides);

const makeEventSchemasRepository = (overrides: Partial<EventSchemasRepository> = {}) =>
	Object.assign(Object.create(null), defaultEventSchemasRepository(), overrides);

const makeEntitySchemasRepository = (overrides: Partial<EntitySchemasRepository> = {}) =>
	Object.assign(Object.create(null), defaultEntitySchemasRepository(), overrides);

type TestLayerOptions = {
	eventsService?: EventsService;
	importsRepository?: ImportsRepository;
	entitiesRepository?: EntitiesRepository;
	collectionsService?: CollectionsService;
	eventSchemasRepository?: EventSchemasRepository;
	entitySchemasRepository?: EntitySchemasRepository;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(ImportsRepository, options.importsRepository ?? makeImportsRepository()),
		Layer.succeed(EntitiesRepository, options.entitiesRepository ?? makeEntitiesRepository()),
		Layer.succeed(CollectionsService, options.collectionsService ?? makeCollectionsService()),
		Layer.succeed(EventsService, options.eventsService ?? makeEventsService()),
		Layer.succeed(
			EventSchemasRepository,
			options.eventSchemasRepository ?? makeEventSchemasRepository(),
		),
		Layer.succeed(
			EntitySchemasRepository,
			options.entitySchemasRepository ?? makeEntitySchemasRepository(),
		),
	);

const makeWorkflowEngine = (instance: WorkflowInstance["Type"]) => {
	let engine: WorkflowEngine["Type"];

	engine = {
		poll: () => Effect.die("unused"),
		resume: () => Effect.die("unused"),
		execute: () => Effect.die("unused"),
		register: () => Effect.die("unused"),
		interrupt: () => Effect.die("unused"),
		deferredDone: () => Effect.die("unused"),
		scheduleClock: () => Effect.die("unused"),
		deferredResult: () => Effect.die("unused"),
		activityExecute: (activity) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					activity.execute.pipe(
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(WorkflowInstance, instance),
					),
				);

				return new Workflow.Complete({ exit });
			}),
	} as WorkflowEngine["Type"];

	return engine;
};

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(ProcessImportRunWorkflow, executionId);
	const engine = makeWorkflowEngine(instance);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

const importPayload = {
	runId: "run-1",
	userId: "user-1",
	source: "goodreads",
	filePath: "/tmp/import.csv",
	sourcePayloadKey: "payload-1",
};

it.effect("orchestrates one-time media imports through workflow-owned phases", () => {
	const cleanupCalls: Array<Record<string, unknown>> = [];
	const resolvedCalls: Array<Record<string, unknown>> = [];
	const importedCalls: Array<Record<string, unknown>> = [];
	const collectionAdds: Array<Record<string, unknown>> = [];
	const ownershipMarks: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const recordedFailures: Array<Record<string, unknown>> = [];
	const createdEvents: Array<ReadonlyArray<Record<string, unknown>>> = [];

	const options = {
		importsRepository: makeImportsRepository({
			createFailure: (input) => {
				recordedFailures.push(input);
				return Effect.void;
			},
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaScriptBySlug: (slug) =>
				Effect.succeed(
					slug === "book.openlibrary"
						? { entitySchemaId: "schema-book", sandboxScriptId: "script-book-openlibrary" }
						: null,
				),
		}),
		collectionsService: makeCollectionsService({
			ensureEntityInLibrary: () => Effect.succeed(undefined),
			getOrCreateCollection: (_userId, name) =>
				Effect.succeed({
					name,
					createdAt: now,
					updatedAt: now,
					properties: {},
					id: `${name}-id`,
					entitySchemaId: "schema-collection",
				}),
			addToCollection: (_user, payload) => {
				collectionAdds.push(payload);
				return Effect.succeed({
					memberOf: {
						createdAt: now,
						properties: {},
						id: "membership-1",
						sourceEntityId: payload.entityId,
						targetEntityId: payload.collectionId,
						relationshipSchemaId: "relationship-1",
					},
				});
			},
			markEntityOwnedInLibrary: (input) => {
				ownershipMarks.push(input);
				return Effect.succeed(undefined);
			},
		}),
		eventsService: makeEventsService({
			createForImport: (_userId, payload) => {
				createdEvents.push(payload as ReadonlyArray<Record<string, unknown>>);
				return Effect.succeed({ count: payload.length });
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-1",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(importPayload, "workflow-1", {
				cleanupArtifacts: (input) =>
					Effect.sync(() => {
						cleanupCalls.push(input);
					}),
				loadAdapterResult: () =>
					Effect.succeed({
						cleanupPaths: ["/tmp/import.csv"],
						adapterResult: {
							failures: [{ itemIndex: 0, message: "Bad source row" }],
							entityGroups: [
								{
									itemIndex: 1,
									ownershipProvider: "goodreads",
									collectionMemberships: [{ collectionName: "Favorites" }],
									events: [{ occurredAt: now, eventSchemaSlug: "read", properties: { rating: 5 } }],
									entityRef: {
										kind: "unresolved",
										identifierType: "isbn",
										sourceLabel: "Book One",
										entitySchemaSlug: "book",
										identifierValue: "9781234567890",
									},
								},
							],
						},
					}),
				resolveExternalId: (input) =>
					Effect.sync(() => {
						resolvedCalls.push(input);
						return { externalId: "OL123M" };
					}),
				importEntity: (input) =>
					Effect.sync(() => {
						importedCalls.push(input);
						return { id: "entity-1" };
					}),
			});

			expect(resolvedCalls).toEqual([
				{
					userId: "user-1",
					value: "9781234567890",
					identifierType: "isbn",
					scriptId: "script-book-openlibrary",
					executionId: "workflow-1-resolve-0-0",
				},
			]);
			expect(importedCalls).toEqual([
				{
					userId: "user-1",
					externalId: "OL123M",
					activityPrefix: "populate-0-",
					entitySchemaId: "schema-book",
					executionId: "workflow-1-entity-0",
					scriptId: "script-book-openlibrary",
				},
			]);
			expect(recordedFailures).toHaveLength(1);
			expect(recordedFailures[0]).toMatchObject({
				itemIndex: 0,
				runId: "run-1",
				message: "Bad source row",
				stage: "input_transformation",
			});
			expect(collectionAdds).toEqual([
				{ collectionId: "Favorites-id", entityId: "entity-1", properties: {} },
			]);
			expect(createdEvents).toEqual([
				[
					{
						occurredAt: now,
						entityId: "entity-1",
						properties: { rating: 5 },
						eventSchemaId: "event-schema-1",
					},
				],
			]);
			expect(ownershipMarks).toEqual([
				{
					userId: "user-1",
					entityId: "entity-1",
					provider: "goodreads",
					syncedAt: expect.any(String),
				},
			]);
			expect(cleanupCalls).toEqual([
				{ cleanupPaths: ["/tmp/import.csv"], sourcePayloadKey: "payload-1" },
			]);

			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run-1", status: "running" }),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run-1", totalItems: 2 }),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run-1", progress: 30 }),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run-1", progress: 90 }),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run-1", progress: 99 }),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					progress: 100,
					runId: "run-1",
					failedItems: 1,
					importedItems: 1,
					processedItems: 2,
					status: "completed",
				}),
			);
		}),
	);
});

it.effect(
	"fails the run and cleans up artifacts when adapter loading fails catastrophically",
	() => {
		let importCalled = false;
		let resolveCalled = false;
		const cleanupCalls: Array<Record<string, unknown>> = [];
		const recordedUpdates: Array<Record<string, unknown>> = [];

		const options = {
			importsRepository: makeImportsRepository({
				updateRun: (input) => {
					recordedUpdates.push(input);
					return Effect.void;
				},
			}),
		} satisfies TestLayerOptions;

		return withTestLayer(
			options,
			"workflow-failure",
			Effect.gen(function* () {
				yield* runOneTimeMediaImportWorkflow(importPayload, "workflow-failure", {
					cleanupArtifacts: (input) =>
						Effect.sync(() => {
							cleanupCalls.push(input);
						}),
					loadAdapterResult: () =>
						Effect.fail({ message: "Source credentials failed", cleanupPaths: [] }),
					resolveExternalId: () =>
						Effect.sync(() => {
							resolveCalled = true;
							return { externalId: null };
						}),
					importEntity: () =>
						Effect.sync(() => {
							importCalled = true;
							return { id: "entity-1" };
						}),
				});

				expect(resolveCalled).toBe(false);
				expect(importCalled).toBe(false);
				expect(cleanupCalls).toEqual([{ cleanupPaths: [], sourcePayloadKey: "payload-1" }]);
				expect(recordedUpdates).toContainEqual(
					expect.objectContaining({ runId: "run-1", status: "running" }),
				);
				expect(recordedUpdates).toContainEqual(
					expect.objectContaining({
						runId: "run-1",
						status: "failed",
						errorSummary: "Source credentials failed",
					}),
				);
			}),
		);
	},
);
