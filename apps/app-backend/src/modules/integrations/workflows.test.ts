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
import { ImportsRepository } from "~/modules/imports/repository";

import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { ProcessIntegrationRunWorkflow, runIntegrationRunWorkflow } from "./workflows";

const now = "2026-06-17T00:00:00.000Z";

const dbRunnerLayer = Layer.succeed(DbRunner, <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const makeIntegration = (overrides: Partial<IntegrationRecord> = {}): IntegrationRecord => ({
	name: null,
	id: "int_1",
	lot: "sink",
	createdAt: now,
	updatedAt: now,
	userId: "user_1",
	provider: "kodi",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	syncOwnership: false,
	lastFinishedAt: null,
	providerSpecifics: { kind: "kodi" },
	webhookUrl: "http://localhost:3000/_i/int_1",
	extraSettings: { disableOnContinuousErrors: false },
	...overrides,
});

const makeRun = (status: "completed" | "failed") => ({
	status,
	progress: 0,
	id: "run_1",
	source: "kodi",
	failedItems: 0,
	createdAt: now,
	updatedAt: now,
	startedAt: null,
	finishedAt: null,
	totalItems: null,
	inputSummary: {},
	importedItems: 0,
	processedItems: 0,
	errorSummary: null,
});

const defaultImportsRepository = () =>
	Object.assign(Object.create(null), {
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
	});

const defaultIntegrationsRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "IntegrationsRepository" as const,
		getForUser: () => Effect.die("unused"),
		listForUser: () => Effect.die("unused"),
		updateForUser: () => Effect.succeed(null),
		deleteForUser: () => Effect.die("unused"),
		createForUser: () => Effect.die("unused"),
		getByIdAnyUser: () => Effect.succeed(makeIntegration()),
		getUserDisableIntegrations: () => Effect.succeed(false),
		listEnabledYankIntegrations: () => Effect.die("unused"),
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
		findGlobalEntityByExternalId: () => Effect.die("unused"),
		findEntityByExternalIdForUser: () => Effect.die("unused"),
		deleteUserRelationshipsForEntity: () => Effect.die("unused"),
		findEntitySchemaScriptBySlug: (slug: string) =>
			Effect.succeed(
				slug === "movie.tmdb"
					? { entitySchemaId: "schema-movie", sandboxScriptId: "script-movie-tmdb" }
					: null,
			),
	});

const defaultCollectionsService = () =>
	Object.assign(Object.create(null), {
		_tag: "CollectionsService" as const,
		create: () => Effect.die("unused"),
		markEntityOwnedInLibrary: () => Effect.void,
		addToCollection: () => Effect.die("unused"),
		removeFromCollection: () => Effect.die("unused"),
		getOrCreateCollection: () => Effect.die("unused"),
		ensureEntityInLibrary: () => Effect.succeed(undefined),
		ensureLibraryEntityForUser: () => Effect.die("unused"),
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
		getBuiltinBySlug: () => Effect.succeed({ id: "builtin-movie-schema" }),
	});

const makeImportsRepository = (overrides: Partial<ImportsRepository> = {}) =>
	Object.assign(Object.create(null), defaultImportsRepository(), overrides);

const makeIntegrationsRepository = (overrides: Partial<IntegrationsRepository> = {}) =>
	Object.assign(Object.create(null), defaultIntegrationsRepository(), overrides);

type TestLayerOptions = {
	eventsService?: EventsService;
	importsRepository?: ImportsRepository;
	integrationsRepository?: IntegrationsRepository;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(ImportsRepository, options.importsRepository ?? makeImportsRepository()),
		Layer.succeed(
			IntegrationsRepository,
			options.integrationsRepository ?? makeIntegrationsRepository(),
		),
		Layer.succeed(EntitiesRepository, defaultEntitiesRepository()),
		Layer.succeed(CollectionsService, defaultCollectionsService()),
		Layer.succeed(EventsService, options.eventsService ?? defaultEventsService()),
		Layer.succeed(EventSchemasRepository, defaultEventSchemasRepository()),
		Layer.succeed(EntitySchemasRepository, defaultEntitySchemasRepository()),
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
	const instance = WorkflowInstance.initial(ProcessIntegrationRunWorkflow, executionId);
	const engine = makeWorkflowEngine(instance);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

const sinkPayload = {
	runId: "run_1",
	userId: "user_1",
	integrationId: "int_1",
	contentType: "application/json",
	rawBody: JSON.stringify({ lot: "movie", progress: 30, identifier: "603" }),
};

const noopOperations = {
	processYank: () => Effect.void,
	importEntity: () => Effect.succeed({ id: "entity-1" }),
	resolveExternalId: () => Effect.succeed({ externalId: null }),
};

it.effect("processes a successful sink run through shared media orchestration", () => {
	const importedCalls: Array<Record<string, unknown>> = [];
	const integrationUpdates: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const createdEvents: Array<ReadonlyArray<Record<string, unknown>>> = [];

	const options = {
		eventsService: Object.assign(Object.create(null), defaultEventsService(), {
			createForImport: (_userId: string, payload: ReadonlyArray<Record<string, unknown>>) => {
				createdEvents.push(payload);
				return Effect.succeed({ count: payload.length });
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
				processYank: () => Effect.void,
				resolveExternalId: () => Effect.succeed({ externalId: null }),
				importEntity: (input) =>
					Effect.sync(() => {
						importedCalls.push(input);
						return { id: "entity-1" };
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
					runId: "run_1",
					userId: "user_1",
					integrationId: "int_1",
					contentType: "application/json",
				},
				"run_1",
				{
					...noopOperations,
					importEntity: () =>
						Effect.sync(() => {
							importCalled = true;
							return { id: "entity-1" };
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

it.effect("fails the run when the integration is disabled", () => {
	let parsed = false;
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		importsRepository: makeImportsRepository({
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(makeIntegration({ isDisabled: true })),
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
						parsed = true;
						return { id: "entity-1" };
					}),
			});

			expect(parsed).toBe(false);
			expect(recordedUpdates).toEqual([
				expect.objectContaining({
					runId: "run_1",
					status: "failed",
					errorSummary: "Integration is disabled",
				}),
			]);
		}),
	);
});

it.effect("fails the run when integrations are disabled for the user", () => {
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		importsRepository: makeImportsRepository({
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		integrationsRepository: makeIntegrationsRepository({
			getUserDisableIntegrations: () => Effect.succeed(true),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(sinkPayload, "run_1", noopOperations);

			expect(recordedUpdates).toEqual([
				expect.objectContaining({
					runId: "run_1",
					status: "failed",
					errorSummary: "Integrations are disabled for this user",
				}),
			]);
		}),
	);
});

it.effect("fails the run when the integration is not found", () => {
	let yankCalled = false;
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
				processYank: () =>
					Effect.sync(() => {
						yankCalled = true;
					}),
			});

			expect(yankCalled).toBe(false);
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

it.effect("delegates yank runs to the durable queue bridge", () => {
	let parsed = false;
	const yankPayloads: Array<Record<string, unknown>> = [];

	const options = {
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () =>
				Effect.succeed(
					makeIntegration({
						lot: "yank",
						provider: "audiobookshelf",
						providerSpecifics: { kind: "audiobookshelf", token: "tok", baseUrl: "http://abs" },
					}),
				),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(sinkPayload, "run_1", {
				...noopOperations,
				processYank: (payload) =>
					Effect.sync(() => {
						yankPayloads.push(payload);
					}),
				importEntity: () =>
					Effect.sync(() => {
						parsed = true;
						return { id: "entity-1" };
					}),
			});

			expect(parsed).toBe(false);
			expect(yankPayloads).toEqual([sinkPayload]);
		}),
	);
});
