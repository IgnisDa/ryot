import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { badRequest, DbError } from "@ryot/contract/errors";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import {
	AutomationRuleId,
	EntityId,
	EntitySchemaId,
	EventSchemaId,
	ImportRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import Redis from "ioredis";

import { RedisService } from "#lib/infrastructure/redis";
import type { MockOverrides } from "#lib/test-support/effect";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeWorkflowActivityEngine,
} from "#lib/test-support/effect";
import { AutomationsRepository } from "#modules/automations/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";

import { ProcessImportRunWorkflow } from "./import-run-workflow";
import type { ImportRunJobData } from "./jobs";
import {
	OpenScaleImportItemSchema,
	prepareOpenScaleWrites,
	type OpenScaleImportItem,
} from "./measurement/measurement-workflow";
import {
	NonMediaImportWorkflowOperations,
	makeNonMediaImportOperationSet,
	type NonMediaImportOperations,
	type NonMediaImportOperationSet,
} from "./non-media-types";
import { runOneTimeNonMediaImportWorkflow } from "./non-media-workflow";
import { ImportsRepository } from "./repository";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";
import { WorkoutImportItemSchema, type WorkoutImportItem } from "./workout/domain";
import { prepareWorkoutWrites } from "./workout/workout-workflow";

const now = "2026-06-17T00:00:00.000Z";

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockAutomationsRepository = Layer.mock(AutomationsRepository);
const mockEntitiesService = Layer.mock(EntitiesService);
const mockEntitiesRepository = Layer.mock(EntitiesRepository);
const mockEntitySchemasRepository = Layer.mock(EntitySchemasRepository);
const mockEventSchemasRepository = Layer.mock(EventSchemasRepository);
const mockEventsService = Layer.mock(EventsService);
const mockImportRunArtifacts = Layer.mock(ImportRunArtifacts);
const mockRedisService = Layer.mock(RedisService);

const makeRedisService = () => {
	const values = new Map<string, string>();
	return mockRedisService({
		client: new Redis({ lazyConnect: true }),
		get: (key) => Effect.succeed(values.get(key) ?? null),
		set: (key, value) => Effect.sync(() => values.set(key, value)).pipe(Effect.asVoid),
		del: (...keys) =>
			Effect.sync(() => {
				for (const key of keys) {
					values.delete(key);
				}
				return keys.length;
			}),
		_tag: "RedisService",
	});
};

const makeListedEntity = (
	overrides: Partial<Omit<ListedEntity, "properties">> = {},
): Omit<ListedEntity, "properties"> & { properties: Record<string, unknown> } => ({
	createdAt: now,
	updatedAt: now,
	properties: {},
	externalId: null,
	populatedAt: null,
	name: "Entity One",
	sandboxScriptId: null,
	id: EntityId.make("entity-1"),
	entitySchemaId: EntitySchemaId.make("schema-1"),
	...overrides,
});

const makeCreateResult = (entity = makeListedEntity()) => ({
	entity,
	operation: "create" as const,
	entitySchemaSlug: entity.entitySchemaId,
});

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		updateRun: () => Effect.void,
		createFailure: () => Effect.void,
		...overrides,
		_tag: "ImportsRepository",
	});

const makeEntitiesService = (overrides: MockOverrides<typeof mockEntitiesService> = {}) =>
	mockEntitiesService({ ...overrides, _tag: "EntitiesService" });

const makeAutomationsRepository = (
	overrides: MockOverrides<typeof mockAutomationsRepository> = {},
) =>
	mockAutomationsRepository({
		listLifecycleSubscriptions: () => Effect.succeed([]),
		...overrides,
		_tag: "AutomationsRepository",
	});

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		listMatchCandidatesBySchema: () => Effect.succeed([]),
		...overrides,
		_tag: "EntitiesRepository",
	});

const makeEntitySchemasRepository = (
	overrides: MockOverrides<typeof mockEntitySchemasRepository> = {},
) =>
	mockEntitySchemasRepository({
		getBuiltinBySlug: (slug) => Effect.succeed({ id: EntitySchemaId.make(`${slug}-schema`) }),
		...overrides,
		_tag: "EntitySchemasRepository",
	});

const makeEventSchemasRepository = (
	overrides: MockOverrides<typeof mockEventSchemasRepository> = {},
) =>
	mockEventSchemasRepository({
		getBuiltinBySlug: () =>
			Effect.succeed({
				id: EventSchemaId.make("workout-set-event"),
				propertiesSchema: { fields: {}, unknownKeys: "passthrough" },
			}),
		...overrides,
		_tag: "EventSchemasRepository",
	});

const makeEventsService = (overrides: MockOverrides<typeof mockEventsService> = {}) =>
	mockEventsService({
		create: () => Effect.succeed({ count: 1, skipped: 0 }),
		...overrides,
		_tag: "EventsService",
	});

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
	entitiesService?: Layer.Layer<EntitiesService>;
	importsRepository?: Layer.Layer<ImportsRepository>;
	entitiesRepository?: Layer.Layer<EntitiesRepository>;
	importRunArtifacts?: Layer.Layer<ImportRunArtifacts>;
	eventSchemasRepository?: Layer.Layer<EventSchemasRepository>;
	entitySchemasRepository?: Layer.Layer<EntitySchemasRepository>;
	automationsRepository?: Layer.Layer<AutomationsRepository>;
	nonMediaOperations?: (payload: ImportRunJobData) => NonMediaImportOperationSet;
	execute?: (
		...args: Parameters<WorkflowEngine["Type"]["execute"]>
	) => Effect.Effect<unknown, unknown>;
};

const openScaleOperations = (input: {
	loadAdapterResult: NonMediaImportOperations<
		OpenScaleImportItem,
		never,
		never,
		never
	>["loadAdapterResult"];
}): NonMediaImportOperationSet =>
	makeNonMediaImportOperationSet({
		itemSchema: OpenScaleImportItemSchema,
		prepareWrites: prepareOpenScaleWrites,
		loadAdapterResult: input.loadAdapterResult,
	});

const workoutOperations = (input: {
	loadAdapterResult: NonMediaImportOperations<
		WorkoutImportItem,
		never,
		never,
		never
	>["loadAdapterResult"];
}): NonMediaImportOperationSet =>
	makeNonMediaImportOperationSet({
		itemSchema: WorkoutImportItemSchema,
		prepareWrites: prepareWorkoutWrites,
		loadAdapterResult: input.loadAdapterResult,
	});

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		makeAppConfigLayer(),
		makeRedisService(),
		BunFileSystem.layer,
		options.importRunArtifacts ?? makeImportRunArtifacts(),
		Layer.mock(NonMediaImportWorkflowOperations, {
			getOperations: (payload) =>
				Effect.succeed(
					options.nonMediaOperations?.(payload) ??
						openScaleOperations({ loadAdapterResult: () => Effect.die("unused") }),
				),
		}),
		options.importsRepository ?? makeImportsRepository(),
		options.entitiesService ?? makeEntitiesService(),
		options.entitiesRepository ?? makeEntitiesRepository(),
		options.eventsService ?? makeEventsService(),
		options.eventSchemasRepository ?? makeEventSchemasRepository(),
		options.entitySchemasRepository ?? makeEntitySchemasRepository(),
		options.automationsRepository ?? makeAutomationsRepository(),
	);

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(ProcessImportRunWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(
		instance,
		options.execute ? { execute: options.execute } : {},
	);

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
		importRunArtifacts: makeImportRunArtifacts((input) =>
			Effect.sync(() => {
				cleanupCalls.push(input);
			}),
		),
		nonMediaOperations: () =>
			openScaleOperations({
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
			}),
		entitiesService: makeEntitiesService({
			create: (_userId, payload) => {
				createCalls.push(payload);
				return createCalls.length === 2
					? Effect.fail(badRequest("Measurement rejected"))
					: Effect.succeed(
							makeCreateResult(
								makeListedEntity({ id: EntityId.make(`measurement-${createCalls.length}`) }),
							),
						);
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-measurement",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(measurementPayload);

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

			expect(cleanupCalls).toEqual([{ cleanupPaths: ["/tmp/open-scale.csv"], runId: "run-1" }]);
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
		nonMediaOperations: () =>
			openScaleOperations({
				loadAdapterResult: () =>
					Effect.succeed({
						failures: [],
						cleanupPaths: ["/tmp/open-scale.csv"],
						items: [openScaleItem({ itemIndex: 0, sourceLabel: "Weigh-in A" })],
					}),
			}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: () => Effect.succeed(null),
		}),
		entitiesService: makeEntitiesService({
			create: () =>
				Effect.sync(() => {
					createCalled = true;
					return makeCreateResult();
				}),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-measurement-missing-schema",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(measurementPayload);

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
		eventsService: makeEventsService({
			create: (input) => {
				eventCalls.push(input.payload as ReadonlyArray<Record<string, unknown>>);
				return Effect.succeed({ count: input.payload.length, skipped: 0 });
			},
		}),
		importsRepository: makeImportsRepository({
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		nonMediaOperations: () =>
			workoutOperations({
				loadAdapterResult: () =>
					Effect.succeed({ failures: [], items: [workoutItem], cleanupPaths: ["/tmp/hevy.csv"] }),
			}),
		entitiesService: makeEntitiesService({
			create: (_userId, payload) => {
				createCalls.push(payload);
				return Effect.succeed(
					makeCreateResult(
						makeListedEntity({
							name: payload.name,
							entitySchemaId: payload.entitySchemaId,
							id: EntityId.make(`${payload.entitySchemaId}-entity`),
						}),
					),
				);
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-workout",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(workoutPayload);

			expect(createCalls.map((payload) => payload["entitySchemaId"])).toEqual([
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

const ruleId = AutomationRuleId.make("rule-1");

const twoExerciseWorkout = {
	...workoutItem,
	exercises: [
		{
			name: "Bench Press",
			kind: "reps_and_weight" as const,
			sets: [{ setLot: "normal" as const, reps: 5, weight: 80 }],
		},
		{
			name: "Squat",
			kind: "reps_and_weight" as const,
			sets: [{ setLot: "normal" as const, reps: 5, weight: 100 }],
		},
	],
};

it.effect(
	"dispatches import entity-create occurrences only for newly created workout entities",
	() => {
		const captured: Array<Record<string, unknown>> = [];

		const existingBench = {
			...makeListedEntity({ id: EntityId.make("existing-bench"), name: "Bench Press" }),
			properties: { kind: "reps_and_weight" },
		};

		const options = {
			execute: (_workflow, execOptions) => {
				captured.push(execOptions as Record<string, unknown>);
				return Effect.void;
			},
			automationsRepository: makeAutomationsRepository({
				listLifecycleSubscriptions: () => Effect.succeed([{ id: ruleId }]),
			}),
			entitiesRepository: makeEntitiesRepository({
				listMatchCandidatesBySchema: () => Effect.succeed([existingBench]),
			}),
			nonMediaOperations: () =>
				workoutOperations({
					loadAdapterResult: () =>
						Effect.succeed({
							failures: [],
							cleanupPaths: ["/tmp/hevy.csv"],
							items: [twoExerciseWorkout],
						}),
				}),
			entitiesService: makeEntitiesService({
				create: (_userId, payload) =>
					Effect.succeed(
						makeCreateResult(
							makeListedEntity({
								name: payload.name,
								entitySchemaId: payload.entitySchemaId,
								id: EntityId.make(`${payload.name}-entity`),
							}),
						),
					),
			}),
		} satisfies TestLayerOptions;

		return withTestLayer(
			options,
			"workflow-workout-dispatch",
			Effect.gen(function* () {
				yield* runOneTimeNonMediaImportWorkflow(workoutPayload);

				expect(captured).toHaveLength(2);
				expect(captured[0]).toMatchObject({
					executionId: "lifecycle-subscription-entity-create-Squat-entity-rule-1",
					payload: {
						ruleId,
						correlationId: "entity-create-Squat-entity",
						automation: {
							automationDepth: 1,
							operation: "create",
							occurrenceId: "entity-create-Squat-entity",
							origin: { kind: "import", importRunId: "run-2" },
							source: { kind: "entity", after: { id: "Squat-entity", name: "Squat" } },
						},
					},
				});
				expect(captured[1]).toMatchObject({
					executionId: "lifecycle-subscription-entity-create-Morning Workout-entity-rule-1",
					payload: {
						correlationId: "entity-create-Morning Workout-entity",
						automation: { origin: { kind: "import", importRunId: "run-2" } },
					},
				});
			}),
		);
	},
);

it.effect("marks the workout item failed when entity-create dispatch fails", () => {
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		execute: () => Effect.fail(new DbError({ message: "dispatch boom" })),
		automationsRepository: makeAutomationsRepository({
			listLifecycleSubscriptions: () => Effect.succeed([{ id: ruleId }]),
		}),
		importsRepository: makeImportsRepository({
			updateRun: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		nonMediaOperations: () =>
			workoutOperations({
				loadAdapterResult: () =>
					Effect.succeed({ failures: [], items: [workoutItem], cleanupPaths: ["/tmp/hevy.csv"] }),
			}),
		entitiesService: makeEntitiesService({
			create: (_userId, payload) =>
				Effect.succeed(
					makeCreateResult(
						makeListedEntity({
							name: payload.name,
							entitySchemaId: payload.entitySchemaId,
							id: EntityId.make(`${payload.entitySchemaId}-entity`),
						}),
					),
				),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-workout-dispatch-failure",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(workoutPayload);

			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					progress: 100,
					runId: "run-2",
					failedItems: 1,
					importedItems: 0,
					processedItems: 1,
					status: "completed",
				}),
			);
		}),
	);
});

it.effect("dispatches an import entity-create occurrence for each measurement entity", () => {
	const captured: Array<Record<string, unknown>> = [];

	const options = {
		execute: (_workflow, execOptions) => {
			captured.push(execOptions as Record<string, unknown>);
			return Effect.void;
		},
		automationsRepository: makeAutomationsRepository({
			listLifecycleSubscriptions: () => Effect.succeed([{ id: ruleId }]),
		}),
		nonMediaOperations: () =>
			openScaleOperations({
				loadAdapterResult: () =>
					Effect.succeed({
						failures: [],
						cleanupPaths: ["/tmp/open-scale.csv"],
						items: [openScaleItem({ itemIndex: 1, sourceLabel: "Weigh-in A" })],
					}),
			}),
		entitiesService: makeEntitiesService({
			create: () =>
				Effect.succeed(
					makeCreateResult(makeListedEntity({ id: EntityId.make("measurement-entity") })),
				),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-measurement-dispatch",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(measurementPayload);

			expect(captured).toHaveLength(1);
			expect(captured[0]).toMatchObject({
				executionId: "lifecycle-subscription-entity-create-measurement-entity-rule-1",
				payload: {
					ruleId,
					correlationId: "entity-create-measurement-entity",
					automation: {
						operation: "create",
						occurrenceId: "entity-create-measurement-entity",
						origin: { kind: "import", importRunId: "run-1" },
					},
				},
			});
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
		nonMediaOperations: () =>
			workoutOperations({
				loadAdapterResult: () =>
					Effect.succeed({ failures: [], items: [workoutItem], cleanupPaths: ["/tmp/hevy.csv"] }),
			}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: () => Effect.succeed(null),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-workout-missing-schema",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(workoutPayload);

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
		importRunArtifacts: makeImportRunArtifacts((input) =>
			Effect.sync(() => {
				cleanupCalls.push(input);
			}),
		),
		nonMediaOperations: () =>
			openScaleOperations({
				loadAdapterResult: () => Effect.die("Could not read import file"),
			}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-measurement-load-failure",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(defectPayload);

			expect(cleanupCalls).toEqual([{ cleanupPaths: [defectPayload.filePath], runId: "run-1" }]);
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
		importRunArtifacts: makeImportRunArtifacts((input) =>
			Effect.sync(() => {
				cleanupCalls.push(input);
			}),
		),
		nonMediaOperations: () =>
			openScaleOperations({
				loadAdapterResult: () =>
					Effect.fail({ cleanupPaths: [], message: "Import job has an invalid file path" }),
			}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-measurement-invalid-path",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(invalidPayload);

			expect(cleanupCalls).toEqual([{ cleanupPaths: [], runId: "run-1" }]);
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
		importRunArtifacts: makeImportRunArtifacts((input) =>
			Effect.sync(() => {
				cleanupCalls.push(input);
			}),
		),
		nonMediaOperations: () =>
			openScaleOperations({
				loadAdapterResult: () => Effect.die("Could not read import file"),
			}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-measurement-invalid-path-defect",
		Effect.gen(function* () {
			yield* runOneTimeNonMediaImportWorkflow(invalidPayload);

			expect(cleanupCalls).toEqual([{ cleanupPaths: [], runId: "run-1" }]);
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
