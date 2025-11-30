import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import {
	EntityId,
	EntitySchemaId,
	EventSchemaId,
	ImportRunId,
	RelationshipId,
	RelationshipSchemaId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import type { MockOverrides } from "#lib/test-support/effect";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeWorkflowActivityEngine,
} from "#lib/test-support/effect";
import { CollectionsService } from "#modules/collections/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EpisodeResolverService } from "#modules/episode-resolver/service";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";

import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { runOneTimeMediaImportWorkflow } from "./media-workflow";
import {
	MediaImportWorkflowOperations,
	type MediaImportWorkflowOperationsValue,
} from "./media/types-workflow";
import { ImportsRepository } from "./repository";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";

const now = "2026-06-17T00:00:00.000Z";

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockEntitiesRepository = Layer.mock(EntitiesRepository);
const mockCollectionsService = Layer.mock(CollectionsService);
const mockEventsService = Layer.mock(EventsService);
const mockEpisodeResolverService = Layer.mock(EpisodeResolverService);
const mockEventSchemasRepository = Layer.mock(EventSchemasRepository);
const mockEntitySchemasRepository = Layer.mock(EntitySchemasRepository);
const mockImportRunArtifacts = Layer.mock(ImportRunArtifacts);

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		updateRun: () => Effect.void,
		createFailure: () => Effect.void,
		...overrides,
		_tag: "ImportsRepository",
	});

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		findEntitySchemaSandboxScriptBySlug: () => Effect.succeed(null),
		...overrides,
		_tag: "EntitiesRepository",
	});

const makeCollectionsService = (overrides: MockOverrides<typeof mockCollectionsService> = {}) =>
	mockCollectionsService({
		markEntityOwnedInLibrary: () => Effect.void,
		getOrCreateCollection: () =>
			Effect.succeed({
				createdAt: now,
				updatedAt: now,
				properties: {},
				externalId: null,
				name: "Collection",
				sandboxScriptId: null,
				id: EntityId.make("collection-1"),
				entitySchemaId: EntitySchemaId.make("schema-collection"),
			}),
		addToCollection: () =>
			Effect.succeed({
				memberOf: {
					createdAt: now,
					properties: {},
					id: RelationshipId.make("membership-1"),
					sourceEntityId: EntityId.make("entity-1"),
					targetEntityId: EntityId.make("collection-1"),
					relationshipSchemaId: RelationshipSchemaId.make("relationship-1"),
				},
			}),
		...overrides,
		_tag: "CollectionsService",
	});

const makeEventsService = (overrides: MockOverrides<typeof mockEventsService> = {}) =>
	mockEventsService({
		create: () => Effect.succeed({ count: 1 }),
		...overrides,
		_tag: "EventsService",
	});

const makeEpisodeResolverService = (
	overrides: MockOverrides<typeof mockEpisodeResolverService> = {},
) =>
	mockEpisodeResolverService({
		...overrides,
		_tag: "EpisodeResolverService",
	});

const makeEventSchemasRepository = (
	overrides: MockOverrides<typeof mockEventSchemasRepository> = {},
) =>
	mockEventSchemasRepository({
		getBuiltinBySlug: () =>
			Effect.succeed({
				id: EventSchemaId.make("event-schema-1"),
				propertiesSchema: { fields: {}, unknownKeys: "passthrough" as const },
			}),
		...overrides,
		_tag: "EventSchemasRepository",
	});

const makeEntitySchemasRepository = (
	overrides: MockOverrides<typeof mockEntitySchemasRepository> = {},
) =>
	mockEntitySchemasRepository({
		getBuiltinBySlug: () => Effect.succeed({ id: EntitySchemaId.make("builtin-book-schema") }),
		...overrides,
		_tag: "EntitySchemasRepository",
	});

const makeMediaOperations = (overrides: Partial<MediaImportWorkflowOperationsValue> = {}) =>
	Layer.mock(MediaImportWorkflowOperations, overrides);

const makeImportRunArtifacts = (
	cleanupArtifacts: NonNullable<
		MockOverrides<typeof mockImportRunArtifacts>["cleanupArtifacts"]
	> = () => Effect.void,
) =>
	mockImportRunArtifacts({
		cleanupArtifacts,
		_tag: "ImportRunArtifacts",
	});

type TestLayerOptions = {
	eventsService?: Layer.Layer<EventsService>;
	importsRepository?: Layer.Layer<ImportsRepository>;
	importRunArtifacts?: Layer.Layer<ImportRunArtifacts>;
	collectionsService?: Layer.Layer<CollectionsService>;
	entitiesRepository?: Layer.Layer<EntitiesRepository>;
	episodeResolverService?: Layer.Layer<EpisodeResolverService>;
	eventSchemasRepository?: Layer.Layer<EventSchemasRepository>;
	entitySchemasRepository?: Layer.Layer<EntitySchemasRepository>;
	mediaOperations?: Layer.Layer<MediaImportWorkflowOperations>;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		makeAppConfigLayer(),
		BunFileSystem.layer,
		options.importRunArtifacts ?? makeImportRunArtifacts(),
		options.mediaOperations ?? makeMediaOperations(),
		options.importsRepository ?? makeImportsRepository(),
		options.entitiesRepository ?? makeEntitiesRepository(),
		options.collectionsService ?? makeCollectionsService(),
		options.episodeResolverService ?? makeEpisodeResolverService(),
		options.eventsService ?? makeEventsService(),
		options.eventSchemasRepository ?? makeEventSchemasRepository(),
		options.entitySchemasRepository ?? makeEntitySchemasRepository(),
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
		importRunArtifacts: makeImportRunArtifacts((input) =>
			Effect.sync(() => {
				cleanupCalls.push(input);
			}),
		),
		mediaOperations: makeMediaOperations({
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
					return { id: EntityId.make("entity-1") };
				}),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaSandboxScriptBySlug: (slug) =>
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
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					sandboxScriptId: null,
					id: EntityId.make(`${name}-id`),
					entitySchemaId: EntitySchemaId.make("schema-collection"),
				}),
			addToCollection: (_user, payload) => {
				collectionAdds.push(payload);
				return Effect.succeed({
					memberOf: {
						createdAt: now,
						properties: {},
						sourceEntityId: payload.entityId,
						targetEntityId: payload.collectionId,
						id: RelationshipId.make("membership-1"),
						relationshipSchemaId: RelationshipSchemaId.make("relationship-1"),
					},
				});
			},
		}),
		eventsService: makeEventsService({
			create: (input) => {
				createdEvents.push(input.payload as ReadonlyArray<Record<string, unknown>>);
				return Effect.succeed({ count: input.payload.length });
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-1",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(importPayload, "workflow-1");

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

it.effect("resolves imported show episode progress and drops unresolved locators", () => {
	const resolverCalls: Array<Record<string, unknown>> = [];
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
		mediaOperations: makeMediaOperations({
			importEntity: () => Effect.succeed({ id: EntityId.make("show-entity-1") }),
			loadAdapterResult: () =>
				Effect.succeed({
					cleanupPaths: [],
					adapterResult: {
						failures: [],
						entityGroups: [
							{
								itemIndex: 1,
								collectionMemberships: [],
								entityRef: {
									kind: "resolved",
									externalId: "show-1",
									scriptSlug: "show.tmdb",
									sourceLabel: "Test Show",
									entitySchemaSlug: "show",
								},
								events: [
									{
										occurredAt: now,
										eventSchemaSlug: "progress",
										properties: { progressPercent: 100 },
										episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 2 },
									},
									{
										occurredAt: now,
										eventSchemaSlug: "progress",
										properties: { progressPercent: 100 },
										episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 99 },
									},
								],
							},
						],
					},
				}),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaSandboxScriptBySlug: (slug) =>
				Effect.succeed(
					slug === "show.tmdb"
						? {
								entitySchemaId: EntitySchemaId.make("schema-show"),
								sandboxScriptId: SandboxScriptId.make("script-show-tmdb"),
							}
						: null,
				),
		}),
		collectionsService: makeCollectionsService({
			ensureEntityInLibrary: () => Effect.void,
		}),
		episodeResolverService: makeEpisodeResolverService({
			resolveShowEpisode: (input) =>
				Effect.sync(() => {
					resolverCalls.push(input);
					return input.episodeNumber === 2 ? EntityId.make("episode-1") : null;
				}),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getBuiltinBySlug: (input) =>
				Effect.succeed(
					input.entitySchemaId === "schema-show-episode" && input.slug === "progress"
						? { id: EventSchemaId.make("event-schema-progress"), propertiesSchema: { fields: {} } }
						: null,
				),
		}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: (slug) => {
				let result: { id: EntitySchemaId } | null = null;
				if (slug === "show") {
					result = { id: EntitySchemaId.make("schema-show") };
				} else if (slug === "show-episode") {
					result = { id: EntitySchemaId.make("schema-show-episode") };
				}
				return Effect.succeed(result);
			},
		}),
		eventsService: makeEventsService({
			create: (input) => {
				createdEvents.push(input.payload as ReadonlyArray<Record<string, unknown>>);
				return Effect.succeed({ count: input.payload.length });
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-show-episode-resolution",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(importPayload, "workflow-show-episode-resolution");

			expect(resolverCalls).toEqual([
				{ seasonNumber: 1, episodeNumber: 2, userId: "user-1", showEntityId: "show-entity-1" },
				{ seasonNumber: 1, userId: "user-1", episodeNumber: 99, showEntityId: "show-entity-1" },
			]);
			expect(createdEvents).toEqual([
				[
					{
						occurredAt: now,
						entityId: "episode-1",
						properties: { progressPercent: 100 },
						eventSchemaId: "event-schema-progress",
					},
				],
			]);
			expect(recordedFailures).toEqual([
				expect.objectContaining({
					itemIndex: 1,
					runId: "run-1",
					sourceLabel: "Test Show",
					entitySchemaSlug: "show",
					sourceIdentifier: "show-1",
					eventSchemaSlug: "progress",
					stage: "provider_resolution",
					message: "Could not resolve show episode S1E99",
					context: { seasonNumber: 1, episodeNumber: 99 },
				}),
			]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					progress: 100,
					failedItems: 1,
					importedItems: 0,
					processedItems: 1,
					status: "completed",
				}),
			);
		}),
	);
});

it.effect("resolves imported podcast episode progress and drops unresolved locators", () => {
	const resolverCalls: Array<Record<string, unknown>> = [];
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
		mediaOperations: makeMediaOperations({
			importEntity: () => Effect.succeed({ id: EntityId.make("podcast-entity-1") }),
			loadAdapterResult: () =>
				Effect.succeed({
					cleanupPaths: [],
					adapterResult: {
						failures: [],
						entityGroups: [
							{
								itemIndex: 1,
								collectionMemberships: [],
								entityRef: {
									kind: "resolved",
									externalId: "podcast-1",
									sourceLabel: "Test Podcast",
									entitySchemaSlug: "podcast",
									scriptSlug: "podcast.itunes",
								},
								events: [
									{
										occurredAt: now,
										eventSchemaSlug: "progress",
										properties: { progressPercent: 100 },
										episodeLocator: { type: "podcast", episodeNumber: 4 },
									},
									{
										occurredAt: now,
										eventSchemaSlug: "progress",
										properties: { progressPercent: 100 },
										episodeLocator: { type: "podcast", episodeNumber: 99 },
									},
								],
							},
						],
					},
				}),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaSandboxScriptBySlug: (slug) =>
				Effect.succeed(
					slug === "podcast.itunes"
						? {
								entitySchemaId: EntitySchemaId.make("schema-podcast"),
								sandboxScriptId: SandboxScriptId.make("script-podcast-itunes"),
							}
						: null,
				),
		}),
		collectionsService: makeCollectionsService({
			ensureEntityInLibrary: () => Effect.void,
		}),
		episodeResolverService: makeEpisodeResolverService({
			resolvePodcastEpisode: (input) =>
				Effect.sync(() => {
					resolverCalls.push(input);
					return input.episodeNumber === 4 ? EntityId.make("podcast-episode-1") : null;
				}),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getBuiltinBySlug: (input) =>
				Effect.succeed(
					input.entitySchemaId === "schema-podcast-episode" && input.slug === "progress"
						? { id: EventSchemaId.make("event-schema-progress"), propertiesSchema: { fields: {} } }
						: null,
				),
		}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: (slug) => {
				let result: { id: EntitySchemaId } | null = null;
				if (slug === "podcast") {
					result = { id: EntitySchemaId.make("schema-podcast") };
				} else if (slug === "podcast-episode") {
					result = { id: EntitySchemaId.make("schema-podcast-episode") };
				}
				return Effect.succeed(result);
			},
		}),
		eventsService: makeEventsService({
			create: (input) => {
				createdEvents.push(input.payload as ReadonlyArray<Record<string, unknown>>);
				return Effect.succeed({ count: input.payload.length });
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-podcast-episode-resolution",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(importPayload, "workflow-podcast-episode-resolution");

			expect(resolverCalls).toEqual([
				{ userId: "user-1", episodeNumber: 4, podcastEntityId: "podcast-entity-1" },
				{ userId: "user-1", episodeNumber: 99, podcastEntityId: "podcast-entity-1" },
			]);
			expect(createdEvents).toEqual([
				[
					{
						occurredAt: now,
						entityId: "podcast-episode-1",
						properties: { progressPercent: 100 },
						eventSchemaId: "event-schema-progress",
					},
				],
			]);
			expect(recordedFailures).toEqual([
				expect.objectContaining({
					itemIndex: 1,
					runId: "run-1",
					sourceLabel: "Test Podcast",
					entitySchemaSlug: "podcast",
					eventSchemaSlug: "progress",
					stage: "provider_resolution",
					sourceIdentifier: "podcast-1",
					context: { episodeNumber: 99 },
					message: "Could not resolve podcast episode 99",
				}),
			]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					progress: 100,
					failedItems: 1,
					importedItems: 0,
					processedItems: 1,
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
			importRunArtifacts: makeImportRunArtifacts((input) =>
				Effect.sync(() => {
					cleanupCalls.push(input);
				}),
			),
			mediaOperations: makeMediaOperations({
				loadAdapterResult: () => Effect.die("Source credentials failed"),
				resolveExternalId: () =>
					Effect.sync(() => {
						resolveCalled = true;
						return { externalId: null };
					}),
				importEntity: () =>
					Effect.sync(() => {
						importCalled = true;
						return { id: EntityId.make("entity-1") };
					}),
			}),
		} satisfies TestLayerOptions;

		return withTestLayer(
			options,
			"workflow-failure",
			Effect.gen(function* () {
				yield* runOneTimeMediaImportWorkflow(defectPayload, "workflow-failure");

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
		importRunArtifacts: makeImportRunArtifacts((input) =>
			Effect.sync(() => {
				cleanupCalls.push(input);
			}),
		),
		mediaOperations: makeMediaOperations({
			loadAdapterResult: () =>
				Effect.fail({ cleanupPaths: [], message: "Import job has an invalid file path" }),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-invalid-load-path",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(invalidPayload, "workflow-invalid-load-path");

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
		importRunArtifacts: makeImportRunArtifacts((input) =>
			Effect.sync(() => {
				cleanupCalls.push(input);
			}),
		),
		mediaOperations: makeMediaOperations({
			loadAdapterResult: () => Effect.die("Source credentials failed"),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-invalid-load-path-defect",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(invalidPayload, "workflow-invalid-load-path-defect");

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
