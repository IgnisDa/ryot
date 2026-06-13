import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { badRequest } from "#lib/errors";
import { EntityId, EntitySchemaId, ImportRunId, UserId } from "#lib/schema/brands";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeMock,
	makeWorkflowActivityEngine,
} from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import type { ListedEntity } from "#modules/entities/schemas";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";

import { OpenScaleImportItemSchema, prepareOpenScaleWrites } from "./measurement/workflow";
import { ImportsRepository } from "./repository";
import { ProcessImportRunWorkflow } from "./worker";
import { runOneTimeNonMediaImportWorkflow } from "./workflows-non-media";
import { WorkoutImportItemSchema } from "./workout/domain";
import { prepareWorkoutWrites } from "./workout/workflow";

const now = "2026-06-17T00:00:00.000Z";

const makeListedEntity = (
	overrides: Partial<Omit<ListedEntity, "properties">> = {},
): Omit<ListedEntity, "properties"> & { properties: Record<string, unknown> } => ({
	image: null,
	id: EntityId.make("entity-1"),
	createdAt: now,
	updatedAt: now,
	properties: {},
	externalId: null,
	populatedAt: null,
	name: "Entity One",
	sandboxScriptId: null,
	entitySchemaId: EntitySchemaId.make("schema-1"),
	...overrides,
});

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

const makeEntitiesService = (overrides: Partial<EntitiesService> = {}) =>
	makeMock<EntitiesService>(
		{
			_tag: "EntitiesService" as const,
			getById: () => Effect.die("unused"),
			import: () => Effect.die("unused"),
			create: () => Effect.die("unused"),
			getImportResult: () => Effect.die("unused"),
			upsertUserRelationship: () => Effect.die("unused"),
			insertUserRelationship: () => Effect.die("unused"),
			writeEntityRelationship: () => Effect.die("unused"),
		},
		overrides,
	);

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	makeMock<EntitiesRepository>(
		{
			_tag: "EntitiesRepository" as const,
			saveEntity: () => Effect.die("unused"),
			getByIdForUser: () => Effect.die("unused"),
			listMatchCandidatesBySchema: () => Effect.succeed([]),
			findEntitySchemaScriptBySlug: () => Effect.die("unused"),
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
			listVisibleBySlugs: () => Effect.die("unused"),
			getBuiltinBySlug: (slug: string) => Effect.succeed({ id: `${slug}-schema` }),
		},
		overrides,
	);

const makeEventSchemasRepository = (overrides: Partial<EventSchemasRepository> = {}) =>
	makeMock<EventSchemasRepository>(
		{
			_tag: "EventSchemasRepository" as const,
			getBuiltinBySlug: () =>
				Effect.succeed({
					id: "workout-set-event",
					propertiesSchema: { fields: {}, unknownKeys: "passthrough" },
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

type TestLayerOptions = {
	eventsService?: EventsService;
	importsRepository?: ImportsRepository;
	entitiesService?: EntitiesService;
	entitiesRepository?: EntitiesRepository;
	eventSchemasRepository?: EventSchemasRepository;
	entitySchemasRepository?: EntitySchemasRepository;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		makeAppConfigLayer(),
		Layer.succeed(ImportsRepository, options.importsRepository ?? makeImportsRepository()),
		Layer.succeed(EntitiesService, options.entitiesService ?? makeEntitiesService()),
		Layer.succeed(EntitiesRepository, options.entitiesRepository ?? makeEntitiesRepository()),
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

const openScaleItem = (overrides: { itemIndex: number; sourceLabel: string }) => ({
	sourceLabel: overrides.sourceLabel,
	itemIndex: overrides.itemIndex,
	sourceIdentifier: overrides.sourceLabel,
	properties: {
		comment: null,
		recordedAt: now,
		statistics: [{ key: "weight", label: "Weight", value: 80 }],
	},
});

const measurementPayload = {
	userId: UserId.make("user-1"),
	source: "open_scale",
	filePath: "/tmp/open-scale.csv",
	runId: ImportRunId.make("run-1"),
};

it.effect("orchestrates open-scale measurement imports through workflow-owned phases", () => {
	const createCalls: Array<Record<string, unknown>> = [];
	const cleanupCalls: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const recordedFailures: Array<Record<string, unknown>> = [];

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
		entitiesService: makeEntitiesService({
			create: (_user, payload) => {
				createCalls.push(payload);
				return createCalls.length === 2
					? Effect.fail(badRequest("Measurement rejected"))
					: Effect.succeed(
							makeListedEntity({ id: EntityId.make(`measurement-${createCalls.length}`) }),
						);
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-measurement",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(measurementPayload, {
				itemSchema: OpenScaleImportItemSchema,
				prepareWrites: prepareOpenScaleWrites,
				cleanupArtifacts: (input) =>
					Effect.sync(() => {
						cleanupCalls.push(input);
					}),
				loadAdapterResult: () =>
					Effect.succeed({
						cleanupPaths: ["/tmp/open-scale.csv"],
						failures: [
							{
								itemIndex: 0,
								message: "Bad row",
								sourceLabel: "Row 1",
								sourceIdentifier: "1",
							},
						],
						items: [
							openScaleItem({ itemIndex: 1, sourceLabel: "Weigh-in A" }),
							openScaleItem({ itemIndex: 2, sourceLabel: "Weigh-in B" }),
						],
					}),
			});

			expect(createCalls).toHaveLength(2);
			expect(createCalls[0]).toMatchObject({
				name: "Measurement - Weigh-in A",
				entitySchemaId: "measurement-schema",
			});

			expect(recordedFailures).toHaveLength(2);
			expect(recordedFailures).toContainEqual(
				expect.objectContaining({
					itemIndex: 0,
					runId: "run-1",
					message: "Bad row",
					stage: "input_transformation",
				}),
			);
			expect(recordedFailures).toContainEqual(
				expect.objectContaining({
					itemIndex: 2,
					runId: "run-1",
					stage: "database_commit",
					entitySchemaSlug: "measurement",
					message: "Measurement rejected",
				}),
			);

			expect(cleanupCalls).toEqual([{ cleanupPaths: ["/tmp/open-scale.csv"] }]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run-1", status: "running" }),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run-1", totalItems: 3 }),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					progress: 100,
					runId: "run-1",
					failedItems: 2,
					importedItems: 1,
					processedItems: 3,
					status: "completed",
				}),
			);
		}),
	);
});

it.effect("fails the open-scale run when the measurement entity schema is missing", () => {
	let createCalled = false;
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		importsRepository: makeImportsRepository({
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: () => Effect.succeed(null),
		}),
		entitiesService: makeEntitiesService({
			create: () =>
				Effect.sync(() => {
					createCalled = true;
					return makeListedEntity();
				}),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-measurement-missing-schema",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(measurementPayload, {
				itemSchema: OpenScaleImportItemSchema,
				prepareWrites: prepareOpenScaleWrites,
				cleanupArtifacts: () => Effect.void,
				loadAdapterResult: () =>
					Effect.succeed({
						failures: [],
						cleanupPaths: ["/tmp/open-scale.csv"],
						items: [openScaleItem({ itemIndex: 0, sourceLabel: "Weigh-in A" })],
					}),
			});

			expect(createCalled).toBe(false);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run-1",
					status: "failed",
					errorSummary: "Measurement entity schema not found",
				}),
			);
		}),
	);
});

const workoutPayload = {
	userId: UserId.make("user-1"),
	source: "hevy",
	filePath: "/tmp/hevy.csv",
	runId: ImportRunId.make("run-2"),
};

const workoutItem = {
	itemIndex: 0,
	endedAt: null,
	name: "Morning Workout",
	sourceIdentifier: "w-1",
	sourceLabel: "Morning Workout",
	startedAt: "2024-01-01T08:00:00.000Z",
	exercises: [
		{
			name: "Bench Press",
			kind: "reps_and_weight" as const,
			sets: [{ setLot: "normal" as const, reps: 5, weight: 80 }],
		},
	],
};

it.effect("orchestrates workout imports through workflow-owned phases", () => {
	const createCalls: Array<Record<string, unknown>> = [];
	const eventCalls: Array<ReadonlyArray<Record<string, unknown>>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		importsRepository: makeImportsRepository({
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		entitiesService: makeEntitiesService({
			create: (_user, payload) => {
				createCalls.push(payload);
				return Effect.succeed(
					makeListedEntity({
						name: payload.name,
						entitySchemaId: payload.entitySchemaId,
						id: EntityId.make(`${payload.entitySchemaId}-entity`),
					}),
				);
			},
		}),
		eventsService: makeEventsService({
			createForImport: (_userId, payload) => {
				eventCalls.push(payload as ReadonlyArray<Record<string, unknown>>);
				return Effect.succeed({ count: payload.length });
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-workout",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(workoutPayload, {
				itemSchema: WorkoutImportItemSchema,
				prepareWrites: prepareWorkoutWrites,
				cleanupArtifacts: () => Effect.void,
				loadAdapterResult: () =>
					Effect.succeed({ failures: [], items: [workoutItem], cleanupPaths: ["/tmp/hevy.csv"] }),
			});

			expect(createCalls.map((payload) => payload.entitySchemaId)).toEqual([
				"exercise-schema",
				"workout-schema",
			]);
			expect(eventCalls).toHaveLength(1);
			expect(eventCalls[0]).toHaveLength(1);
			expect(eventCalls[0]?.[0]).toMatchObject({
				entityId: "exercise-schema-entity",
				sessionEntityId: "workout-schema-entity",
				eventSchemaId: "workout-set-event",
			});

			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run-2", totalItems: 1 }),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					progress: 100,
					runId: "run-2",
					failedItems: 0,
					importedItems: 1,
					processedItems: 1,
					status: "completed",
				}),
			);
		}),
	);
});

it.effect("fails the workout run when workout schemas are missing", () => {
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		importsRepository: makeImportsRepository({
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: () => Effect.succeed(null),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-workout-missing-schema",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(workoutPayload, {
				itemSchema: WorkoutImportItemSchema,
				prepareWrites: prepareWorkoutWrites,
				cleanupArtifacts: () => Effect.void,
				loadAdapterResult: () =>
					Effect.succeed({ failures: [], items: [workoutItem], cleanupPaths: ["/tmp/hevy.csv"] }),
			});

			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run-2",
					status: "failed",
					errorSummary: "Workout import schemas are missing",
				}),
			);
		}),
	);
});

it.effect("fails the run and cleans up when non-media adapter loading fails", () => {
	const cleanupCalls: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const defectPayload = { ...measurementPayload, filePath: "/tmp/open-scale.csv" };

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
		"workflow-measurement-load-failure",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(defectPayload, {
				itemSchema: OpenScaleImportItemSchema,
				prepareWrites: prepareOpenScaleWrites,
				cleanupArtifacts: (input) =>
					Effect.sync(() => {
						cleanupCalls.push(input);
					}),
				loadAdapterResult: () => Effect.die("Could not read import file"),
			});

			expect(cleanupCalls).toEqual([{ cleanupPaths: [defectPayload.filePath] }]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run-1",
					status: "failed",
					errorSummary: "Could not read import file",
				}),
			);
		}),
	);
});

it.effect("does not reintroduce invalid file paths during handled non-media load failures", () => {
	const cleanupCalls: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const invalidPayload = { ...measurementPayload, filePath: "../../etc/passwd" };

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
		"workflow-measurement-invalid-path",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(invalidPayload, {
				itemSchema: OpenScaleImportItemSchema,
				prepareWrites: prepareOpenScaleWrites,
				cleanupArtifacts: (input) =>
					Effect.sync(() => {
						cleanupCalls.push(input);
					}),
				loadAdapterResult: () =>
					Effect.fail({
						message: "Import job has an invalid file path",
						cleanupPaths: [],
					}),
			});

			expect(cleanupCalls).toEqual([{ cleanupPaths: [] }]);
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

it.effect("does not attempt cleanup for invalid file paths when non-media loading defects", () => {
	const cleanupCalls: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const invalidPayload = { ...measurementPayload, filePath: "../../etc/passwd" };

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
		"workflow-measurement-invalid-path-defect",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(invalidPayload, {
				itemSchema: OpenScaleImportItemSchema,
				prepareWrites: prepareOpenScaleWrites,
				loadAdapterResult: () => Effect.die("Could not read import file"),
				cleanupArtifacts: (input) =>
					Effect.sync(() => {
						cleanupCalls.push(input);
					}),
			});

			expect(cleanupCalls).toEqual([{ cleanupPaths: [] }]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run-1",
					status: "failed",
					errorSummary: "Could not read import file",
				}),
			);
		}),
	);
});
