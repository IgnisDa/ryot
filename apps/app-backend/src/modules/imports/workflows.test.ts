import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import {
	EntityId,
	EntitySchemaId,
	ImportRunId,
	RelationshipId,
	RelationshipSchemaId,
	SandboxScriptId,
	UserId,
} from "#lib/schema/brands";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeMock,
	makeWorkflowActivityEngine,
} from "#lib/test-support/effect";
import { CollectionsService } from "#modules/collections/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";

import { ImportsRepository } from "./repository";
import { ProcessImportRunWorkflow } from "./worker";
import { runOneTimeMediaImportWorkflow } from "./workflows";

const now = "2026-06-17T00:00:00.000Z";

const makeImportsRepository = (overrides: Partial<ImportsRepository> = {}) =>
	makeMock<ImportsRepository>(
		{
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
		},
		overrides,
	);

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	makeMock<EntitiesRepository>(
		{
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
		},
		overrides,
	);

const makeCollectionsService = (overrides: Partial<CollectionsService> = {}) =>
	makeMock<CollectionsService>(
		{
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
		},
		overrides,
	);

const makeEventsService = (overrides: Partial<EventsService> = {}) =>
	makeMock<EventsService>(
		{
			_tag: "EventsService" as const,
			list: () => Effect.die("unused"),
			create: () => Effect.die("unused"),
			createForIntegration: () => Effect.die("unused"),
			createForImport: () => Effect.succeed({ count: 1 }),
		},
		overrides,
	);

const makeEventSchemasRepository = (overrides: Partial<EventSchemasRepository> = {}) =>
	makeMock<EventSchemasRepository>(
		{
			_tag: "EventSchemasRepository" as const,
			listForUser: () => Effect.die("unused"),
			getScopeForUser: () => Effect.die("unused"),
			createEventSchema: () => Effect.die("unused"),
			updateEventSchema: () => Effect.die("unused"),
			deleteEventSchema: () => Effect.die("unused"),
			getEntitySchemaScopeById: () => Effect.die("unused"),
			getBuiltinBySlug: () => Effect.succeed({ id: "event-schema-1" }),
		},
		overrides,
	);

const makeEntitySchemasRepository = (overrides: Partial<EntitySchemasRepository> = {}) =>
	makeMock<EntitySchemasRepository>(
		{
			_tag: "EntitySchemasRepository" as const,
			listByUser: () => Effect.die("unused"),
			findBySlug: () => Effect.die("unused"),
			getByIdForUser: () => Effect.die("unused"),
			createEntitySchema: () => Effect.die("unused"),
			updateEntitySchema: () => Effect.die("unused"),
			deleteEntitySchema: () => Effect.die("unused"),
			getBuiltinBySlug: () => Effect.succeed({ id: "builtin-book-schema" }),
		},
		overrides,
	);

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
		makeAppConfigLayer(),
		BunFileSystem.layer,
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

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(ProcessImportRunWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

const importPayload = {
	userId: UserId.make("user-1"),
	source: "goodreads",
	filePath: "/tmp/import.csv",
	sourcePayloadKey: "payload-1",
	runId: ImportRunId.make("run-1"),
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
						? {
								entitySchemaId: EntitySchemaId.make("schema-book"),
								sandboxScriptId: SandboxScriptId.make("script-book-openlibrary"),
							}
						: null,
				),
		}),
		collectionsService: makeCollectionsService({
			ensureEntityInLibrary: () => Effect.void,
			markEntityOwnedInLibrary: (input) => {
				ownershipMarks.push(input);
				return Effect.void;
			},
			getOrCreateCollection: (_userId, name) =>
				Effect.succeed({
					name,
					image: null,
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					id: EntityId.make(`${name}-id`),
					sandboxScriptId: null,
					entitySchemaId: EntitySchemaId.make("schema-collection"),
				}),
			addToCollection: (_user, payload) => {
				collectionAdds.push(payload);
				return Effect.succeed({
					memberOf: {
						createdAt: now,
						properties: {},
						id: RelationshipId.make("membership-1"),
						sourceEntityId: payload.entityId,
						targetEntityId: payload.collectionId,
						relationshipSchemaId: RelationshipSchemaId.make("relationship-1"),
					},
				});
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
				searchEntities: () => Effect.die("unused"),
				importEntity: (input) =>
					Effect.sync(() => {
						importedCalls.push(input);
						return { id: EntityId.make("entity-1") };
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
		const defectPayload = { ...importPayload, filePath: "/tmp/import.csv" };

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
				yield* runOneTimeMediaImportWorkflow(defectPayload, "workflow-failure", {
					cleanupArtifacts: (input) =>
						Effect.sync(() => {
							cleanupCalls.push(input);
						}),
					loadAdapterResult: () => Effect.die("Source credentials failed"),
					resolveExternalId: () =>
						Effect.sync(() => {
							resolveCalled = true;
							return { externalId: null };
						}),
					searchEntities: () => Effect.die("unused"),
					importEntity: () =>
						Effect.sync(() => {
							importCalled = true;
							return { id: EntityId.make("entity-1") };
						}),
				});

				expect(resolveCalled).toBe(false);
				expect(importCalled).toBe(false);
				expect(cleanupCalls).toEqual([
					{ cleanupPaths: [defectPayload.filePath], sourcePayloadKey: "payload-1" },
				]);
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

it.effect("does not reintroduce invalid file paths during handled load failures", () => {
	const cleanupCalls: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const invalidPayload = { ...importPayload, filePath: "../../etc/passwd" };

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
		"workflow-invalid-load-path",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(invalidPayload, "workflow-invalid-load-path", {
				cleanupArtifacts: (input) =>
					Effect.sync(() => {
						cleanupCalls.push(input);
					}),
				loadAdapterResult: () =>
					Effect.fail({
						message: "Import job has an invalid file path",
						cleanupPaths: [],
					}),
				resolveExternalId: () => Effect.die("unused"),
				searchEntities: () => Effect.die("unused"),
				importEntity: () => Effect.die("unused"),
			});

			expect(cleanupCalls).toEqual([{ cleanupPaths: [], sourcePayloadKey: "payload-1" }]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run-1",
					status: "failed",
					errorSummary: "Import job has an invalid file path",
				}),
			);
		}),
	);
});

it.effect("does not attempt cleanup for invalid file paths when adapter loading defects", () => {
	const cleanupCalls: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const invalidPayload = { ...importPayload, filePath: "../../etc/passwd" };

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
		"workflow-invalid-load-path-defect",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(invalidPayload, "workflow-invalid-load-path-defect", {
				cleanupArtifacts: (input) =>
					Effect.sync(() => {
						cleanupCalls.push(input);
					}),
				loadAdapterResult: () => Effect.die("Source credentials failed"),
				resolveExternalId: () => Effect.die("unused"),
				searchEntities: () => Effect.die("unused"),
				importEntity: () => Effect.die("unused"),
			});

			expect(cleanupCalls).toEqual([{ cleanupPaths: [], sourcePayloadKey: "payload-1" }]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run-1",
					status: "failed",
					errorSummary: "Source credentials failed",
				}),
			);
		}),
	);
});
