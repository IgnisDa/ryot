import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { RedisService } from "#lib/redis";
import { EntityId, ImportRunId, IntegrationId, UserId } from "#lib/schema/brands";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeMock,
	makeWorkflowActivityEngine,
} from "#lib/test-support/effect";
import { CollectionsService } from "#modules/collections/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EpisodeResolverService } from "#modules/episode-resolver/service";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";
import { ImportsRepository } from "#modules/imports/repository";

import { IntegrationsRepository } from "./repository";
import {
	makeIntegration,
	makeKomgaIntegration,
	makeRun,
	makeYoutubeMusicIntegration,
} from "./test-support";
import { ProcessIntegrationRunWorkflow, runIntegrationRunWorkflow } from "./workflows";

const now = "2026-06-17T00:00:00.000Z";

const mangaGroup = (overrides: Record<string, unknown> = {}) => ({
	itemIndex: 0,
	collectionMemberships: [],
	events: [{ occurredAt: now, eventSchemaSlug: "progress", properties: { progressPercent: 50 } }],
	entityRef: {
		externalId: "30002",
		sourceLabel: "Berserk",
		entitySchemaSlug: "manga",
		kind: "resolved" as const,
		scriptSlug: "manga.anilist",
	},
	...overrides,
});

const makeImportsRepository = (overrides: Partial<ImportsRepository> = {}) =>
	makeMock<ImportsRepository>(
		{
			updateRun: () => Effect.void,
			createFailure: () => Effect.void,
			_tag: "ImportsRepository" as const,
			createRun: () => Effect.die("unused"),
			getRunById: () => Effect.succeed(null),
			deleteRunById: () => Effect.die("unused"),
			listRunsByUser: () => Effect.die("unused"),
			listFailuresByRunId: () => Effect.die("unused"),
			listRunsByIntegrationId: () => Effect.die("unused"),
			hasActiveRunForIntegration: () => Effect.die("unused"),
			listRecentStatusesByIntegrationId: () => Effect.succeed([]),
		},
		overrides,
	);

const makeIntegrationsRepository = (overrides: Partial<IntegrationsRepository> = {}) =>
	makeMock<IntegrationsRepository>(
		{
			_tag: "IntegrationsRepository" as const,
			getForUser: () => Effect.die("unused"),
			listForUser: () => Effect.die("unused"),
			updateForUser: () => Effect.succeed(null),
			deleteForUser: () => Effect.die("unused"),
			createForUser: () => Effect.die("unused"),
			getByIdAnyUser: () => Effect.succeed(makeIntegration()),
			getUserDisableIntegrations: () => Effect.succeed(false),
			listEnabledYankIntegrations: () => Effect.die("unused"),
		},
		overrides,
	);

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	makeMock<EntitiesRepository>(
		{
			_tag: "EntitiesRepository" as const,
			saveEntity: () => Effect.die("unused"),
			getByIdForUser: () => Effect.die("unused"),
			findEntitySchemaById: () => Effect.die("unused"),
			getEntityScopeForUser: () => Effect.die("unused"),
			listMatchCandidatesBySchema: () => Effect.die("unused"),
			getEntitySchemaScopeForUser: () => Effect.die("unused"),
			findGlobalEntityByExternalId: () => Effect.die("unused"),
			findEntityByExternalIdForUser: () => Effect.die("unused"),
			findEntitySchemaScriptBySlug: (slug: string) =>
				Effect.succeed(
					slug === "movie.tmdb"
						? { entitySchemaId: "schema-movie", sandboxScriptId: "script-movie-tmdb" }
						: slug === "manga.anilist"
							? { entitySchemaId: "schema-manga", sandboxScriptId: "script-manga-anilist" }
							: slug === "music.youtube-music"
								? { entitySchemaId: "schema-music", sandboxScriptId: "script-youtube-music" }
								: null,
				),
		},
		overrides,
	);

const makeCollectionsService = (overrides: Partial<CollectionsService> = {}) =>
	makeMock<CollectionsService>(
		{
			_tag: "CollectionsService" as const,
			ensureEntityInLibrary: () => Effect.void,
			create: () => Effect.die("unused"),
			markEntityOwnedInLibrary: () => Effect.void,
			addToCollection: () => Effect.die("unused"),
			removeFromCollection: () => Effect.die("unused"),
			getOrCreateCollection: () => Effect.die("unused"),
			ensureLibraryEntityForUser: () => Effect.die("unused"),
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

const makeEpisodeResolverService = () =>
	makeMock<EpisodeResolverService>({
		_tag: "EpisodeResolverService" as const,
		resolveShowEpisode: () => Effect.die("unused"),
		resolvePodcastEpisode: () => Effect.die("unused"),
	});

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
			listVisibleBySlugs: () => Effect.die("unused"),
			getBuiltinBySlug: () => Effect.succeed({ id: "builtin-schema" }),
		},
		overrides,
	);

const makeRedisService = (claimed = true) =>
	makeMock<RedisService>({
		_tag: "RedisService" as const,
		claim: () => Effect.succeed(claimed),
	});

type TestLayerOptions = {
	claimed?: boolean;
	eventsService?: EventsService;
	importsRepository?: ImportsRepository;
	collectionsService?: CollectionsService;
	integrationsRepository?: IntegrationsRepository;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		makeAppConfigLayer(),
		BunFileSystem.layer,
		Layer.succeed(RedisService, makeRedisService(options.claimed)),
		Layer.succeed(ImportsRepository, options.importsRepository ?? makeImportsRepository()),
		Layer.succeed(
			IntegrationsRepository,
			options.integrationsRepository ?? makeIntegrationsRepository(),
		),
		Layer.succeed(EntitiesRepository, makeEntitiesRepository()),
		Layer.succeed(CollectionsService, options.collectionsService ?? makeCollectionsService()),
		Layer.succeed(EpisodeResolverService, makeEpisodeResolverService()),
		Layer.succeed(EventsService, options.eventsService ?? makeEventsService()),
		Layer.succeed(EventSchemasRepository, makeEventSchemasRepository()),
		Layer.succeed(EntitySchemasRepository, makeEntitySchemasRepository()),
	);

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(ProcessIntegrationRunWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

const sinkPayload = {
	userId: UserId.make("user_1"),
	runId: ImportRunId.make("run_1"),
	contentType: "application/json",
	integrationId: IntegrationId.make("int_1"),
	rawBody: JSON.stringify({ lot: "movie", progress: 30, identifier: "603" }),
};

const yankPayload = {
	userId: UserId.make("user_1"),
	runId: ImportRunId.make("run_1"),
	integrationId: IntegrationId.make("int_1"),
};

const noopOperations = {
	importEntity: () => Effect.succeed({ id: EntityId.make("entity-1") }),
	resolveExternalId: () => Effect.succeed({ externalId: null }),
	loadYankAdapterResult: () =>
		Effect.succeed({ cleanupPaths: [], adapterResult: { failures: [], entityGroups: [] } }),
	runSandboxHistory: () =>
		Effect.succeed({ status: "completed" as const, value: { songs: [] }, logs: [], error: null }),
};

it.effect("processes a successful sink run through shared media orchestration", () => {
	const importedCalls: Array<Record<string, unknown>> = [];
	const createdEvents: Array<Record<string, unknown>> = [];
	const integrationUpdates: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		eventsService: makeEventsService({
			createForImport: () => Effect.die("should not be called"),
			createForIntegration: (input: {
				integrationId: string;
				importRunId: string;
				userId: string;
				payload: ReadonlyArray<Record<string, unknown>>;
			}) => {
				createdEvents.push(input);
				return Effect.succeed({ count: input.payload.length });
			},
		}),
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("completed")),
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		integrationsRepository: makeIntegrationsRepository({
			updateForUser: (input) => {
				integrationUpdates.push(input);
				return Effect.succeed(makeIntegration());
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(sinkPayload, "run_1", {
				...noopOperations,
				importEntity: (input) =>
					Effect.sync(() => {
						importedCalls.push(input);
						return { id: EntityId.make("entity-1") };
					}),
			});

			expect(importedCalls).toEqual([
				{
					userId: "user_1",
					externalId: "603",
					activityPrefix: "populate-0-",
					executionId: "run_1-entity-0",
					scriptId: "script-movie-tmdb",
					entitySchemaId: "schema-movie",
				},
			]);
			expect(createdEvents).toHaveLength(1);
			expect(createdEvents[0]).toMatchObject({
				userId: "user_1",
				importRunId: "run_1",
				integrationId: "int_1",
				payload: [
					expect.objectContaining({ entityId: "entity-1", eventSchemaId: "event-schema-1" }),
				],
			});
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run_1", status: "running" }),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					progress: 100,
					runId: "run_1",
					importedItems: 1,
					processedItems: 1,
					status: "completed",
				}),
			);
			expect(integrationUpdates).toHaveLength(1);
			expect(integrationUpdates[0]).toMatchObject({
				userId: "user_1",
				integrationId: "int_1",
				lastFinishedAt: expect.any(Date),
			});
		}),
	);
});

it.effect("records adapter-only sink failures and fails the run", () => {
	let importCalled = false;
	const recordedFailures: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
			createFailure: (input) => {
				recordedFailures.push(input);
				return Effect.void;
			},
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(
				{
					rawBody: "{}",
					userId: UserId.make("user_1"),
					runId: ImportRunId.make("run_1"),
					contentType: "application/json",
					integrationId: IntegrationId.make("int_1"),
				},
				"run_1",
				{
					...noopOperations,
					importEntity: () =>
						Effect.sync(() => {
							importCalled = true;
							return { id: EntityId.make("entity-1") };
						}),
				},
			);

			expect(importCalled).toBe(false);
			expect(recordedFailures).toEqual([
				{
					itemIndex: 0,
					context: null,
					runId: "run_1",
					sourceLabel: undefined,
					sourceIdentifier: undefined,
					stage: "input_transformation",
					message: "Could not parse Kodi webhook payload",
				},
			]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run_1",
					progress: 100,
					totalItems: 1,
					failedItems: 1,
					processedItems: 1,
				}),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run_1",
					status: "failed",
					errorSummary: "Could not parse Kodi webhook payload",
				}),
			);
		}),
	);
});

it.effect("fails the run when the integration is not found", () => {
	let mediaProcessed = false;
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		importsRepository: makeImportsRepository({
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(null),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(sinkPayload, "run_1", {
				...noopOperations,
				importEntity: () =>
					Effect.sync(() => {
						mediaProcessed = true;
						return { id: EntityId.make("entity-1") };
					}),
			});

			expect(mediaProcessed).toBe(false);
			expect(recordedUpdates).toEqual([
				expect.objectContaining({
					runId: "run_1",
					status: "failed",
					errorSummary: "Integration not found",
				}),
			]);
		}),
	);
});

it.effect("processes a komga yank run through shared media orchestration", () => {
	const importedCalls: Array<Record<string, unknown>> = [];
	const createdEvents: Array<Record<string, unknown>> = [];
	const integrationUpdates: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		eventsService: makeEventsService({
			createForImport: () => Effect.die("should not be called"),
			createForIntegration: (input: {
				userId: string;
				importRunId: string;
				integrationId: string;
				payload: ReadonlyArray<Record<string, unknown>>;
			}) => {
				createdEvents.push(input);
				return Effect.succeed({ count: input.payload.length });
			},
		}),
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("completed")),
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(makeKomgaIntegration()),
			updateForUser: (input) => {
				integrationUpdates.push(input);
				return Effect.succeed(makeKomgaIntegration());
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1", {
				...noopOperations,
				importEntity: (input) =>
					Effect.sync(() => {
						importedCalls.push(input);
						return { id: EntityId.make("entity-1") };
					}),
				loadYankAdapterResult: () =>
					Effect.succeed({
						cleanupPaths: [],
						adapterResult: { failures: [], entityGroups: [mangaGroup()] },
					}),
			});

			expect(importedCalls).toEqual([
				{
					userId: "user_1",
					externalId: "30002",
					activityPrefix: "populate-0-",
					executionId: "run_1-entity-0",
					entitySchemaId: "schema-manga",
					scriptId: "script-manga-anilist",
				},
			]);
			expect(createdEvents).toHaveLength(1);
			expect(createdEvents[0]).toMatchObject({
				userId: "user_1",
				importRunId: "run_1",
				integrationId: "int_1",
			});
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					progress: 100,
					runId: "run_1",
					importedItems: 1,
					processedItems: 1,
					status: "completed",
				}),
			);
			expect(integrationUpdates).toHaveLength(1);
			expect(integrationUpdates[0]).toMatchObject({
				userId: "user_1",
				integrationId: "int_1",
				lastFinishedAt: expect.any(Date),
			});
		}),
	);
});

it.effect("fails the whole run on catastrophic yank provider failure", () => {
	let importCalled = false;
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(makeKomgaIntegration()),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1", {
				...noopOperations,
				importEntity: () =>
					Effect.sync(() => {
						importCalled = true;
						return { id: EntityId.make("entity-1") };
					}),
				loadYankAdapterResult: () =>
					Effect.fail({ cleanupPaths: [], message: "Failed to fetch data from Komga" }),
			});

			expect(importCalled).toBe(false);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run_1",
					status: "failed",
					errorSummary: "Failed to fetch data from Komga",
				}),
			);
		}),
	);
});

it.effect("marks ownership for synced yank items", () => {
	const ownershipMarks: Array<Record<string, unknown>> = [];

	const options = {
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("completed")),
		}),
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(makeKomgaIntegration({ syncOwnership: true })),
			updateForUser: () => Effect.succeed(makeKomgaIntegration()),
		}),
		collectionsService: makeCollectionsService({
			markEntityOwnedInLibrary: (input: Record<string, unknown>) => {
				ownershipMarks.push(input);
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1", {
				...noopOperations,
				loadYankAdapterResult: () =>
					Effect.succeed({
						cleanupPaths: [],
						adapterResult: {
							failures: [],
							entityGroups: [mangaGroup({ events: [], ownershipProvider: "komga" })],
						},
					}),
			});

			expect(ownershipMarks).toEqual([
				expect.objectContaining({ userId: "user_1", provider: "komga", entityId: "entity-1" }),
			]);
		}),
	);
});

it.effect("processes a YouTube Music yank run through workflow-owned sandbox execution", () => {
	const importedCalls: Array<Record<string, unknown>> = [];
	const sandboxCalls: Array<Record<string, unknown>> = [];
	const createdEvents: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		integrationsRepository: makeIntegrationsRepository({
			updateForUser: () => Effect.succeed(makeYoutubeMusicIntegration()),
			getByIdAnyUser: () => Effect.succeed(makeYoutubeMusicIntegration()),
		}),
		eventsService: makeEventsService({
			createForImport: () => Effect.die("should not be called"),
			createForIntegration: (input: {
				userId: string;
				importRunId: string;
				integrationId: string;
				payload: ReadonlyArray<Record<string, unknown>>;
			}) => {
				createdEvents.push(input);
				return Effect.succeed({ count: input.payload.length });
			},
		}),
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("completed")),
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1", {
				...noopOperations,
				importEntity: (input) =>
					Effect.sync(() => {
						importedCalls.push(input);
						return { id: EntityId.make("entity-1") };
					}),
				runSandboxHistory: (input) =>
					Effect.sync(() => {
						sandboxCalls.push(input);
						return {
							logs: [],
							error: null,
							status: "completed" as const,
							value: { songs: [{ title: "Song A", videoId: "vid1" }] },
						};
					}),
			});

			expect(sandboxCalls).toEqual([
				{
					userId: "user_1",
					scriptId: "script-youtube-music",
					executionId: "run_1-youtube-music-history",
					context: { authCookie: "cookie", timezone: "America/New_York" },
				},
			]);
			expect(importedCalls).toEqual([
				expect.objectContaining({
					userId: "user_1",
					externalId: "vid1",
					entitySchemaId: "schema-music",
					scriptId: "script-youtube-music",
				}),
			]);
			expect(createdEvents).toHaveLength(1);
			expect(createdEvents[0]).toMatchObject({
				userId: "user_1",
				importRunId: "run_1",
				integrationId: "int_1",
				payload: [expect.objectContaining({ entityId: "entity-1" })],
			});
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					progress: 100,
					runId: "run_1",
					importedItems: 1,
					status: "completed",
				}),
			);
		}),
	);
});

it.effect("records a YouTube Music sandbox failure as a source-fetch failure", () => {
	let importCalled = false;
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const recordedFailures: Array<Record<string, unknown>> = [];
	const integrationUpdates: Array<Record<string, unknown>> = [];

	const options = {
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(makeYoutubeMusicIntegration()),
			updateForUser: (input) => {
				integrationUpdates.push(input);
				return Effect.succeed(makeYoutubeMusicIntegration());
			},
		}),
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
			createFailure: (input) => {
				recordedFailures.push(input);
				return Effect.void;
			},
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1", {
				...noopOperations,
				importEntity: () =>
					Effect.sync(() => {
						importCalled = true;
						return { id: EntityId.make("entity-1") };
					}),
				runSandboxHistory: () =>
					Effect.succeed({
						logs: [],
						value: null,
						status: "completed" as const,
						error: "history fetch failed",
					}),
			});

			expect(importCalled).toBe(false);
			expect(recordedFailures).toContainEqual(
				expect.objectContaining({
					itemIndex: 0,
					runId: "run_1",
					stage: "source_fetch",
					message: "history fetch failed",
				}),
			);
			expect(integrationUpdates).toEqual([]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run_1", failedItems: 1, processedItems: 1 }),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run_1", status: "failed" }),
			);
		}),
	);
});

it.effect("disables a yank integration after continuous failures during finalization", () => {
	const integrationUpdates: Array<Record<string, unknown>> = [];

	const options = {
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
			listRecentStatusesByIntegrationId: () =>
				Effect.succeed([
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
				]),
		}),
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () =>
				Effect.succeed(
					makeKomgaIntegration({ extraSettings: { disableOnContinuousErrors: true } }),
				),
			updateForUser: (input) => {
				integrationUpdates.push(input);
				return Effect.succeed(makeKomgaIntegration({ isDisabled: true }));
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1", {
				...noopOperations,
				loadYankAdapterResult: () =>
					Effect.fail({ cleanupPaths: [], message: "Failed to fetch data from Komga" }),
			});

			expect(integrationUpdates).toEqual([
				{ userId: "user_1", isDisabled: true, integrationId: "int_1" },
			]);
		}),
	);
});
