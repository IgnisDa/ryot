import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";
import Redis from "ioredis";

import { RedisService } from "#lib/redis";
import {
	EntityId,
	EntitySchemaId,
	EventSchemaId,
	ImportRunId,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "#lib/schema/brands";
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
import {
	MediaImportWorkflowOperations,
	type MediaImportWorkflowOperationsValue,
} from "#modules/imports/media/workflow-types";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportRunArtifacts } from "#modules/imports/runtime/workflow-helpers";

import { IntegrationsRepository } from "./repository";
import {
	makeIntegration,
	makeKomgaIntegration,
	makeRun,
	makeYoutubeMusicIntegration,
} from "./test-support";
import {
	IntegrationRunOperations,
	type IntegrationRunOperationsValue,
	ProcessIntegrationRunWorkflow,
	runIntegrationRunWorkflow,
} from "./workflows";

const now = "2026-06-17T00:00:00.000Z";

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockIntegrationsRepository = Layer.mock(IntegrationsRepository);
const mockEntitiesRepository = Layer.mock(EntitiesRepository);
const mockCollectionsService = Layer.mock(CollectionsService);
const mockEventsService = Layer.mock(EventsService);
const mockEpisodeResolverService = Layer.mock(EpisodeResolverService);
const mockEventSchemasRepository = Layer.mock(EventSchemasRepository);
const mockEntitySchemasRepository = Layer.mock(EntitySchemasRepository);
const mockRedisService = Layer.mock(RedisService);
const mockImportRunArtifacts = Layer.mock(ImportRunArtifacts);

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

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		updateRun: () => Effect.void,
		createFailure: () => Effect.void,
		getRunById: () => Effect.succeed(null),
		listRecentStatusesByIntegrationId: () => Effect.succeed([]),
		...overrides,
		_tag: "ImportsRepository",
	});

const makeIntegrationsRepository = (
	overrides: MockOverrides<typeof mockIntegrationsRepository> = {},
) =>
	mockIntegrationsRepository({
		updateForUser: () => Effect.succeed(null),
		getByIdAnyUser: () => Effect.succeed(makeIntegration()),
		getUserDisableIntegrations: () => Effect.succeed(false),
		...overrides,
		_tag: "IntegrationsRepository",
	});

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		findEntitySchemaScriptBySlug: (slug) => {
			let result: { entitySchemaId: EntitySchemaId; sandboxScriptId: SandboxScriptId } | null =
				null;
			switch (slug) {
				case "movie.tmdb": {
					result = {
						entitySchemaId: EntitySchemaId.make("schema-movie"),
						sandboxScriptId: SandboxScriptId.make("script-movie-tmdb"),
					};
					break;
				}
				case "manga.anilist": {
					result = {
						entitySchemaId: EntitySchemaId.make("schema-manga"),
						sandboxScriptId: SandboxScriptId.make("script-manga-anilist"),
					};
					break;
				}
				case "music.youtube-music": {
					result = {
						entitySchemaId: EntitySchemaId.make("schema-music"),
						sandboxScriptId: SandboxScriptId.make("script-youtube-music"),
					};
					break;
				}
			}
			return Effect.succeed(result);
		},
		...overrides,
		_tag: "EntitiesRepository",
	});

const makeCollectionsService = (overrides: MockOverrides<typeof mockCollectionsService> = {}) =>
	mockCollectionsService({
		ensureEntityInLibrary: () => Effect.void,
		markEntityOwnedInLibrary: () => Effect.void,
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
		getBuiltinBySlug: () => Effect.succeed({ id: EntitySchemaId.make("builtin-schema") }),
		...overrides,
		_tag: "EntitySchemasRepository",
	});

const makeRedisService = (claimed = true) =>
	mockRedisService({
		claim: () => Effect.succeed(claimed),
		client: makeRedisClient(),
		_tag: "RedisService",
	});

const makeRedisClient = (): RedisService["client"] =>
	Object.assign(Object.create(Redis.prototype), {
		duplicate: makeRedisClient,
	});

const makeImportRunArtifacts = () =>
	mockImportRunArtifacts({ cleanupArtifacts: () => Effect.void, _tag: "ImportRunArtifacts" });

type TestLayerOptions = {
	claimed?: boolean;
	eventsService?: Layer.Layer<EventsService>;
	importsRepository?: Layer.Layer<ImportsRepository>;
	collectionsService?: Layer.Layer<CollectionsService>;
	integrationsRepository?: Layer.Layer<IntegrationsRepository>;
	mediaOperations?: Partial<MediaImportWorkflowOperationsValue>;
	integrationOperations?: Partial<IntegrationRunOperationsValue>;
};

const makeMediaOperations = (overrides: Partial<MediaImportWorkflowOperationsValue> = {}) =>
	Layer.mock(MediaImportWorkflowOperations, {
		resolveExternalId: () => Effect.succeed({ externalId: null }),
		importEntity: () => Effect.succeed({ id: EntityId.make("entity-1") }),
		...overrides,
	});

const makeIntegrationOperations = (overrides: Partial<IntegrationRunOperationsValue> = {}) =>
	Layer.mock(IntegrationRunOperations, {
		loadYankAdapterResult: () =>
			Effect.succeed({ cleanupPaths: [], adapterResult: { failures: [], entityGroups: [] } }),
		runSandboxHistory: () =>
			Effect.succeed({ status: "completed" as const, value: { songs: [] }, logs: [], error: null }),
		...overrides,
	});

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		makeAppConfigLayer(),
		BunFileSystem.layer,
		makeRedisService(options.claimed),
		makeImportRunArtifacts(),
		makeMediaOperations(options.mediaOperations),
		makeIntegrationOperations(options.integrationOperations),
		options.importsRepository ?? makeImportsRepository(),
		options.integrationsRepository ?? makeIntegrationsRepository(),
		makeEntitiesRepository(),
		options.collectionsService ?? makeCollectionsService(),
		makeEpisodeResolverService(),
		options.eventsService ?? makeEventsService(),
		makeEventSchemasRepository(),
		makeEntitySchemasRepository(),
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

it.effect("processes a successful sink run through shared media orchestration", () => {
	const importedCalls: Array<Record<string, unknown>> = [];
	const createdEvents: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const integrationUpdates: Array<Record<string, unknown>> = [];

	const options = {
		mediaOperations: {
			importEntity: (input) =>
				Effect.sync(() => {
					importedCalls.push(input);
					return { id: EntityId.make("entity-1") };
				}),
		},
		eventsService: makeEventsService({
			create: (input) => {
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
			yield* runIntegrationRunWorkflow(sinkPayload, "run_1");

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
				metadata: { importRunId: "run_1", integrationId: "int_1" },
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
		mediaOperations: {
			importEntity: () =>
				Effect.sync(() => {
					importCalled = true;
					return { id: EntityId.make("entity-1") };
				}),
		},
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
		mediaOperations: {
			importEntity: () =>
				Effect.sync(() => {
					mediaProcessed = true;
					return { id: EntityId.make("entity-1") };
				}),
		},
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
			yield* runIntegrationRunWorkflow(sinkPayload, "run_1");

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
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const integrationUpdates: Array<Record<string, unknown>> = [];

	const options = {
		mediaOperations: {
			importEntity: (input) =>
				Effect.sync(() => {
					importedCalls.push(input);
					return { id: EntityId.make("entity-1") };
				}),
		},
		integrationOperations: {
			loadYankAdapterResult: () =>
				Effect.succeed({
					cleanupPaths: [],
					adapterResult: { failures: [], entityGroups: [mangaGroup()] },
				}),
		},
		eventsService: makeEventsService({
			create: (input) => {
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
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

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
				metadata: { importRunId: "run_1", integrationId: "int_1" },
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
		mediaOperations: {
			importEntity: () =>
				Effect.sync(() => {
					importCalled = true;
					return { id: EntityId.make("entity-1") };
				}),
		},
		integrationOperations: {
			loadYankAdapterResult: () =>
				Effect.fail({ cleanupPaths: [], message: "Failed to fetch data from Komga" }),
		},
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
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

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
		integrationOperations: {
			loadYankAdapterResult: () =>
				Effect.succeed({
					cleanupPaths: [],
					adapterResult: {
						failures: [],
						entityGroups: [mangaGroup({ events: [], ownershipProvider: "komga" })],
					},
				}),
		},
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
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			expect(ownershipMarks).toEqual([
				expect.objectContaining({ userId: "user_1", provider: "komga", entityId: "entity-1" }),
			]);
		}),
	);
});

it.effect("processes a YouTube Music yank run through workflow-owned sandbox execution", () => {
	const sandboxCalls: Array<Record<string, unknown>> = [];
	const importedCalls: Array<Record<string, unknown>> = [];
	const createdEvents: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		mediaOperations: {
			importEntity: (input) =>
				Effect.sync(() => {
					importedCalls.push(input);
					return { id: EntityId.make("entity-1") };
				}),
		},
		integrationOperations: {
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
		},
		integrationsRepository: makeIntegrationsRepository({
			updateForUser: () => Effect.succeed(makeYoutubeMusicIntegration()),
			getByIdAnyUser: () => Effect.succeed(makeYoutubeMusicIntegration()),
		}),
		eventsService: makeEventsService({
			create: (input) => {
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
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

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
				metadata: { importRunId: "run_1", integrationId: "int_1" },
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
		mediaOperations: {
			importEntity: () =>
				Effect.sync(() => {
					importCalled = true;
					return { id: EntityId.make("entity-1") };
				}),
		},
		integrationOperations: {
			runSandboxHistory: () =>
				Effect.succeed({
					logs: [],
					value: null,
					status: "completed" as const,
					error: "history fetch failed",
				}),
		},
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
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

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
		integrationOperations: {
			loadYankAdapterResult: () =>
				Effect.fail({ cleanupPaths: [], message: "Failed to fetch data from Komga" }),
		},
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
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			expect(integrationUpdates).toEqual([
				{ userId: "user_1", isDisabled: true, integrationId: "int_1" },
			]);
		}),
	);
});
