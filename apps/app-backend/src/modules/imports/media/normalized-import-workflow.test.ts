import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	ImportRunId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import {
	ResolveEpisodesInput,
	type ResolveEpisodesRef,
} from "@ryot/plugin-media/operations/schemas";
import { Effect, Layer, Schema } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import type { MockOverrides } from "#lib/test-utils/effect";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#lib/test-utils/effect";
import { CollectionsService } from "#modules/collections/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";
import { LibraryEntityImportError } from "#modules/library-membership/library-entity-import-workflow";
import { OperationsService } from "#modules/plugins/operations-service";

import { ImportRunFailuresService } from "../failure-service";
import { loadImportAdapterResult, storeImportAdapterResult } from "../runtime/source-payload-store";
import { ImportsService } from "../service";
import type { MediaImportAdapterResult } from "./adapter-result";
import { ProcessNormalizedMediaImportWorkflow } from "./normalized-import-workflow";
import { processNormalizedMediaImport } from "./normalized-import-workflow-live";
import {
	MediaImportWorkflowOperations,
	type MediaImportWorkflowOperationsValue,
} from "./types-workflow";

const now = "2026-06-17T00:00:00.000Z";

const mockImportRunFailuresService = Layer.mock(ImportRunFailuresService);
const mockImportsService = Layer.mock(ImportsService);
const mockEntitiesRepository = Layer.mock(EntitiesRepository);
const mockCollectionsService = Layer.mock(CollectionsService);
const mockEventsService = Layer.mock(EventsService);
const mockOperationsService = Layer.mock(OperationsService);
const mockEventSchemasRepository = Layer.mock(EventSchemasRepository);
const mockEntitySchemasRepository = Layer.mock(EntitySchemasRepository);

const makeImportRunFailuresService = (
	overrides: MockOverrides<typeof mockImportRunFailuresService> = {},
) =>
	mockImportRunFailuresService({
		create: () => Effect.void,
		...overrides,
		_tag: "ImportRunFailuresService",
	});

const makeImportsService = (overrides: MockOverrides<typeof mockImportsService> = {}) =>
	mockImportsService({
		update: () => Effect.void,
		...overrides,
		_tag: "ImportsService",
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
				entitySchemaSlug: EntitySchemaSlug.make("schema-collection"),
			}),
		...overrides,
		_tag: "CollectionsService",
	});

const makeEventsService = (overrides: MockOverrides<typeof mockEventsService> = {}) =>
	mockEventsService({
		create: () => Effect.succeed({ count: 1, outcomes: [], failure: null }),
		...overrides,
		_tag: "EventsService",
	});

const makeOperationsService = (overrides: MockOverrides<typeof mockOperationsService> = {}) =>
	mockOperationsService({
		...overrides,
		_tag: "OperationsService",
	});

const recordResolveEpisodes = (
	calls: Array<Record<string, unknown>>,
	resolve: (ref: ResolveEpisodesRef) => string | null,
) =>
	makeOperationsService({
		invokeOperation: (input) =>
			Schema.decodeUnknown(ResolveEpisodesInput)(input.payload).pipe(
				Effect.orDie,
				Effect.map(({ refs }) => {
					calls.push({
						refs,
						userId: input.userId,
						pluginSlug: input.pluginSlug,
						operationSlug: input.operationSlug,
					});
					return { results: refs.map((ref) => ({ entityId: resolve(ref) })) };
				}),
			),
	});

const makeEventSchemasRepository = (
	overrides: MockOverrides<typeof mockEventSchemasRepository> = {},
) =>
	mockEventSchemasRepository({
		getBuiltinBySlug: () =>
			Effect.succeed({
				id: EventSchemaSlug.make("event-schema-1"),
				propertiesSchema: { fields: {}, unknownKeys: "passthrough" as const },
			}),
		...overrides,
		_tag: "EventSchemasRepository",
	});

const makeEntitySchemasRepository = (
	overrides: MockOverrides<typeof mockEntitySchemasRepository> = {},
) =>
	mockEntitySchemasRepository({
		getBuiltinBySlug: () =>
			Effect.succeed({
				id: EntitySchemaSlug.make("builtin-book-schema"),
				propertiesSchema: { fields: {} },
			}),
		...overrides,
		_tag: "EntitySchemasRepository",
	});

const makeMediaOperations = (overrides: Partial<MediaImportWorkflowOperationsValue> = {}) =>
	Layer.mock(MediaImportWorkflowOperations, overrides);

const makeRedisLayer = () => {
	const store = new Map<string, string>();
	return Layer.succeed(
		RedisService,
		makeRedisService({
			get: (key) => Effect.succeed(store.get(key) ?? null),
			set: (key, value) =>
				Effect.sync(() => {
					store.set(key, value);
				}),
			del: (...keys) =>
				Effect.sync(() => {
					let removed = 0;
					for (const key of keys) {
						if (store.delete(key)) {
							removed += 1;
						}
					}
					return removed;
				}),
		}),
	);
};

type TestLayerOptions = {
	eventsService?: Layer.Layer<EventsService>;
	importsService?: Layer.Layer<ImportsService>;
	collectionsService?: Layer.Layer<CollectionsService>;
	entitiesRepository?: Layer.Layer<EntitiesRepository>;
	mediaOperations?: Layer.Layer<MediaImportWorkflowOperations>;
	operationsService?: Layer.Layer<OperationsService>;
	eventSchemasRepository?: Layer.Layer<EventSchemasRepository>;
	entitySchemasRepository?: Layer.Layer<EntitySchemasRepository>;
	importRunFailuresService?: Layer.Layer<ImportRunFailuresService>;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		makeAppConfigLayer(),
		BunFileSystem.layer,
		makeRedisLayer(),
		options.mediaOperations ?? makeMediaOperations(),
		options.importsService ?? makeImportsService(),
		options.importRunFailuresService ?? makeImportRunFailuresService(),
		options.entitiesRepository ?? makeEntitiesRepository(),
		options.collectionsService ?? makeCollectionsService(),
		options.operationsService ?? makeOperationsService(),
		options.eventsService ?? makeEventsService(),
		options.eventSchemasRepository ?? makeEventSchemasRepository(),
		options.entitySchemasRepository ?? makeEntitySchemasRepository(),
	);

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(ProcessNormalizedMediaImportWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

const runId = ImportRunId.make("run-1");
const userId = UserId.make("user-1");

const makePayload = (executionId: string) => ({ runId, userId, executionId });

const seedAdapterResult = (adapterResult: MediaImportAdapterResult) =>
	storeImportAdapterResult({ runId, adapterResult });

const resolvedBookGroup = (input: { externalId: string; sourceLabel: string }) => ({
	itemIndex: 1,
	collectionMemberships: [],
	events: [],
	entityRef: {
		kind: "resolved" as const,
		scriptSlug: "book.openlibrary",
		entitySchemaSlug: "book",
		externalId: input.externalId,
		sourceLabel: input.sourceLabel,
	},
});

it.effect("runs the normalized media pipeline through workflow-owned phases", () => {
	const resolvedCalls: Array<Record<string, unknown>> = [];
	const importedCalls: Array<Record<string, unknown>> = [];
	const collectionAdds: Array<Record<string, unknown>> = [];
	const ownershipMarks: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const recordedFailures: Array<Record<string, unknown>> = [];
	const createdEvents: Array<ReadonlyArray<Record<string, unknown>>> = [];

	const options = {
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		importRunFailuresService: makeImportRunFailuresService({
			create: (input) => {
				recordedFailures.push(input);
				return Effect.void;
			},
		}),
		mediaOperations: makeMediaOperations({
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
			writeCollectionMembership: (input) =>
				Effect.sync(() => {
					collectionAdds.push(input);
				}),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaSandboxScriptBySlug: (slug) =>
				Effect.succeed(
					slug === "book.openlibrary"
						? {
								entitySchemaSlug: EntitySchemaSlug.make("schema-book"),
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
					entitySchemaSlug: EntitySchemaSlug.make("schema-collection"),
				}),
		}),
		eventsService: makeEventsService({
			create: (input) => {
				createdEvents.push(input.payload as ReadonlyArray<Record<string, unknown>>);
				return Effect.succeed({
					count: input.payload.length,
					outcomes: [],
					failure: null,
				});
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"normalized-1",
		Effect.gen(function* () {
			yield* seedAdapterResult({
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
			});

			yield* processNormalizedMediaImport(makePayload("normalized-1"), "normalized-1");

			expect(resolvedCalls).toEqual([
				{
					userId: "user-1",
					value: "9781234567890",
					identifierType: "isbn",
					scriptId: "script-book-openlibrary",
					executionId: "normalized-1-resolve-0-0",
				},
			]);
			expect(importedCalls).toEqual([
				{
					userId: "user-1",
					externalId: "OL123M",
					entitySchemaSlug: "schema-book",
					scriptId: "script-book-openlibrary",
					executionId: "normalized-1-entity-0",
					origin: { kind: "import", importRunId: "run-1" },
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
				{
					userId: "user-1",
					entityId: "entity-1",
					collectionId: "Favorites-id",
					executionId: "normalized-1-collection-0-0",
				},
			]);
			expect(createdEvents).toEqual([
				[
					{
						occurredAt: now,
						entityId: "entity-1",
						properties: { rating: 5 },
						eventSchemaSlug: "event-schema-1",
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
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		importRunFailuresService: makeImportRunFailuresService({
			create: (input) => {
				recordedFailures.push(input);
				return Effect.void;
			},
		}),
		mediaOperations: makeMediaOperations({
			importEntity: () => Effect.succeed({ id: EntityId.make("show-entity-1") }),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaSandboxScriptBySlug: (slug) =>
				Effect.succeed(
					slug === "show.tmdb"
						? {
								entitySchemaSlug: EntitySchemaSlug.make("schema-show"),
								sandboxScriptId: SandboxScriptId.make("script-show-tmdb"),
							}
						: null,
				),
		}),
		collectionsService: makeCollectionsService({
			ensureEntityInLibrary: () => Effect.void,
		}),
		operationsService: recordResolveEpisodes(resolverCalls, (ref) =>
			ref.episodeNumber === 2 ? "episode-1" : null,
		),
		eventSchemasRepository: makeEventSchemasRepository({
			getBuiltinBySlug: (input) =>
				Effect.succeed(
					input.entitySchemaSlug === "schema-show-episode" && input.slug === "progress"
						? {
								id: EventSchemaSlug.make("event-schema-progress"),
								propertiesSchema: { fields: {} },
							}
						: null,
				),
		}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: (slug) => {
				let result: { id: EntitySchemaSlug; propertiesSchema: { fields: {} } } | null = null;
				if (slug === "show") {
					result = { id: EntitySchemaSlug.make("schema-show"), propertiesSchema: { fields: {} } };
				} else if (slug === "show-episode") {
					result = {
						id: EntitySchemaSlug.make("schema-show-episode"),
						propertiesSchema: { fields: {} },
					};
				}
				return Effect.succeed(result);
			},
		}),
		eventsService: makeEventsService({
			create: (input) => {
				createdEvents.push(input.payload as ReadonlyArray<Record<string, unknown>>);
				return Effect.succeed({
					count: input.payload.length,
					outcomes: [],
					failure: null,
				});
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"normalized-show-episode-resolution",
		Effect.gen(function* () {
			yield* seedAdapterResult({
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
			});

			yield* processNormalizedMediaImport(
				makePayload("normalized-show-episode-resolution"),
				"normalized-show-episode-resolution",
			);

			expect(resolverCalls).toEqual([
				{
					userId: "user-1",
					pluginSlug: "media",
					operationSlug: "resolve-episodes",
					refs: [
						{
							kind: "show",
							seasonNumber: 1,
							episodeNumber: 2,
							showEntityId: "show-entity-1",
						},
					],
				},
				{
					userId: "user-1",
					pluginSlug: "media",
					operationSlug: "resolve-episodes",
					refs: [
						{
							kind: "show",
							seasonNumber: 1,
							episodeNumber: 99,
							showEntityId: "show-entity-1",
						},
					],
				},
			]);
			expect(createdEvents).toEqual([
				[
					{
						occurredAt: now,
						entityId: "episode-1",
						properties: { progressPercent: 100 },
						eventSchemaSlug: "event-schema-progress",
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
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		importRunFailuresService: makeImportRunFailuresService({
			create: (input) => {
				recordedFailures.push(input);
				return Effect.void;
			},
		}),
		mediaOperations: makeMediaOperations({
			importEntity: () => Effect.succeed({ id: EntityId.make("podcast-entity-1") }),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaSandboxScriptBySlug: (slug) =>
				Effect.succeed(
					slug === "podcast.itunes"
						? {
								entitySchemaSlug: EntitySchemaSlug.make("schema-podcast"),
								sandboxScriptId: SandboxScriptId.make("script-podcast-itunes"),
							}
						: null,
				),
		}),
		collectionsService: makeCollectionsService({
			ensureEntityInLibrary: () => Effect.void,
		}),
		operationsService: recordResolveEpisodes(resolverCalls, (ref) =>
			ref.episodeNumber === 4 ? "podcast-episode-1" : null,
		),
		eventSchemasRepository: makeEventSchemasRepository({
			getBuiltinBySlug: (input) =>
				Effect.succeed(
					input.entitySchemaSlug === "schema-podcast-episode" && input.slug === "progress"
						? {
								id: EventSchemaSlug.make("event-schema-progress"),
								propertiesSchema: { fields: {} },
							}
						: null,
				),
		}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: (slug) => {
				let result: { id: EntitySchemaSlug; propertiesSchema: { fields: {} } } | null = null;
				if (slug === "podcast") {
					result = {
						id: EntitySchemaSlug.make("schema-podcast"),
						propertiesSchema: { fields: {} },
					};
				} else if (slug === "podcast-episode") {
					result = {
						id: EntitySchemaSlug.make("schema-podcast-episode"),
						propertiesSchema: { fields: {} },
					};
				}
				return Effect.succeed(result);
			},
		}),
		eventsService: makeEventsService({
			create: (input) => {
				createdEvents.push(input.payload as ReadonlyArray<Record<string, unknown>>);
				return Effect.succeed({
					count: input.payload.length,
					outcomes: [],
					failure: null,
				});
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"normalized-podcast-episode-resolution",
		Effect.gen(function* () {
			yield* seedAdapterResult({
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
			});

			yield* processNormalizedMediaImport(
				makePayload("normalized-podcast-episode-resolution"),
				"normalized-podcast-episode-resolution",
			);

			expect(resolverCalls).toEqual([
				{
					userId: "user-1",
					pluginSlug: "media",
					operationSlug: "resolve-episodes",
					refs: [{ kind: "podcast", episodeNumber: 4, podcastEntityId: "podcast-entity-1" }],
				},
				{
					userId: "user-1",
					pluginSlug: "media",
					operationSlug: "resolve-episodes",
					refs: [{ kind: "podcast", episodeNumber: 99, podcastEntityId: "podcast-entity-1" }],
				},
			]);
			expect(createdEvents).toEqual([
				[
					{
						occurredAt: now,
						entityId: "podcast-episode-1",
						properties: { progressPercent: 100 },
						eventSchemaSlug: "event-schema-progress",
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
	"records provider_details and database_commit stages from library import failures",
	() => {
		const recordedFailures: Array<Record<string, unknown>> = [];

		const options = {
			importRunFailuresService: makeImportRunFailuresService({
				create: (input) => {
					recordedFailures.push(input);
					return Effect.void;
				},
			}),
			mediaOperations: makeMediaOperations({
				importEntity: (input) =>
					input.externalId === "ext-mem"
						? Effect.fail(
								new LibraryEntityImportError({ stage: "membership", message: "mem fail" }),
							)
						: Effect.fail(
								new LibraryEntityImportError({ stage: "population", message: "pop fail" }),
							),
			}),
			entitiesRepository: makeEntitiesRepository({
				findEntitySchemaSandboxScriptBySlug: (slug) =>
					Effect.succeed(
						slug === "book.openlibrary"
							? {
									entitySchemaSlug: EntitySchemaSlug.make("schema-book"),
									sandboxScriptId: SandboxScriptId.make("script-book-openlibrary"),
								}
							: null,
					),
			}),
		} satisfies TestLayerOptions;

		return withTestLayer(
			options,
			"normalized-stage-failures",
			Effect.gen(function* () {
				yield* seedAdapterResult({
					failures: [],
					entityGroups: [
						resolvedBookGroup({ externalId: "ext-pop", sourceLabel: "Population Book" }),
						resolvedBookGroup({ externalId: "ext-mem", sourceLabel: "Membership Book" }),
					],
				});

				yield* processNormalizedMediaImport(
					makePayload("normalized-stage-failures"),
					"normalized-stage-failures",
				);

				expect(recordedFailures).toContainEqual(
					expect.objectContaining({
						runId: "run-1",
						message: "pop fail",
						stage: "provider_details",
						sourceIdentifier: "ext-pop",
					}),
				);
				expect(recordedFailures).toContainEqual(
					expect.objectContaining({
						runId: "run-1",
						message: "mem fail",
						stage: "database_commit",
						sourceIdentifier: "ext-mem",
					}),
				);
			}),
		);
	},
);

it.effect("fails the run when the normalized adapter artifact is missing or expired", () => {
	return withTestLayer(
		{},
		"normalized-missing-artifact",
		Effect.gen(function* () {
			const exit = yield* processNormalizedMediaImport(
				makePayload("normalized-missing-artifact"),
				"normalized-missing-artifact",
			).pipe(Effect.exit);

			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				const error = exit.cause._tag === "Fail" ? exit.cause.error : null;
				expect(error).toMatchObject({
					_tag: "ImportRunError",
					message: "Normalized media import artifact is missing or expired",
				});
			}
		}),
	);
});

it.effect("round-trips the adapter result through the artifact store", () => {
	const adapterResult: MediaImportAdapterResult = {
		failures: [{ itemIndex: 3, message: "row error", stage: "input_transformation" }],
		entityGroups: [
			{
				itemIndex: 1,
				collectionMemberships: [],
				events: [],
				entityRef: {
					kind: "resolved",
					externalId: "book-1",
					scriptSlug: "book.openlibrary",
					entitySchemaSlug: "book",
					sourceLabel: "Round Trip Book",
				},
			},
		],
	};

	return Effect.gen(function* () {
		yield* storeImportAdapterResult({ runId, adapterResult });
		const loaded = yield* loadImportAdapterResult(runId);
		expect(loaded).toEqual(adapterResult);
	}).pipe(Effect.provide(makeRedisLayer()));
});
