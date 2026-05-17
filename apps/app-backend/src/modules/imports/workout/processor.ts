import { createEntity, listEntityMatchCandidates } from "~/modules/entities";
import type { CreateEntityBody, EntityMatchCandidate, ListedEntity } from "~/modules/entities";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas";
import { getBuiltinEventSchemaBySlug } from "~/modules/event-schemas";
import { createEventsWithTriggers, parseEventProperties } from "~/modules/events";
import type { CreateEventBulkBody } from "~/modules/events";

import { failImportRun, recordImportRunFailure, sanitizeErrorMessage } from "../helpers";
import { createImportRunFailure, updateImportRun } from "../repository";
import {
	buildWorkoutSetEventProperties,
	normalizeExerciseIdentityName,
	type WorkoutAdapterFailure,
	type WorkoutAdapterResult,
	type WorkoutImportExercise,
	type WorkoutImportItem,
} from "./domain";

const PROGRESS_UPDATE_INTERVAL = 10;

type BuiltinEntitySchema = NonNullable<Awaited<ReturnType<typeof getBuiltinEntitySchemaBySlug>>>;
type BuiltinEventSchema = NonNullable<Awaited<ReturnType<typeof getBuiltinEventSchemaBySlug>>>;

type WorkoutImportSchemas = {
	workoutSchema: BuiltinEntitySchema;
	exerciseSchema: BuiltinEntitySchema;
	workoutSetEventSchema: BuiltinEventSchema;
};

type WorkoutSetEventDraft = {
	setOrder: number;
	exerciseOrder: number;
	properties: Record<string, unknown>;
};

export type WorkoutImportProcessorDeps = {
	createEntity: typeof createEntity;
	updateImportRun: typeof updateImportRun;
	createImportRunFailure: typeof createImportRunFailure;
	createEventsWithTriggers: typeof createEventsWithTriggers;
	listEntityMatchCandidates: typeof listEntityMatchCandidates;
	getBuiltinEventSchemaBySlug: typeof getBuiltinEventSchemaBySlug;
	getBuiltinEntitySchemaBySlug: typeof getBuiltinEntitySchemaBySlug;
};

const workoutImportProcessorDeps: WorkoutImportProcessorDeps = {
	createEntity,
	updateImportRun,
	createImportRunFailure,
	createEventsWithTriggers,
	listEntityMatchCandidates,
	getBuiltinEventSchemaBySlug,
	getBuiltinEntitySchemaBySlug,
};

const loadWorkoutImportSchemas = async (deps: WorkoutImportProcessorDeps) => {
	const exerciseSchema = await deps.getBuiltinEntitySchemaBySlug("exercise");
	if (!exerciseSchema) {
		throw new Error("Exercise entity schema not found");
	}

	const workoutSchema = await deps.getBuiltinEntitySchemaBySlug("workout");
	if (!workoutSchema) {
		throw new Error("Workout entity schema not found");
	}

	const workoutSetEventSchema = await deps.getBuiltinEventSchemaBySlug({
		slug: "workout-set",
		entitySchemaId: exerciseSchema.id,
	});
	if (!workoutSetEventSchema) {
		throw new Error("Workout Set event schema not found");
	}

	return { exerciseSchema, workoutSchema, workoutSetEventSchema } satisfies WorkoutImportSchemas;
};

const exerciseIdentityKey = (input: { name: string; kind: string }): string =>
	`${normalizeExerciseIdentityName(input.name)}|${input.kind}`;

const matchExerciseCandidate = (
	exercise: WorkoutImportExercise,
	candidates: EntityMatchCandidate[],
): EntityMatchCandidate | undefined => {
	const key = exerciseIdentityKey(exercise);
	return candidates.find((candidate) => {
		const kind = candidate.properties.kind;
		return typeof kind === "string" && exerciseIdentityKey({ kind, name: candidate.name }) === key;
	});
};

const createCustomExercise = async (input: {
	userId: string;
	exercise: WorkoutImportExercise;
	deps: WorkoutImportProcessorDeps;
	exerciseSchema: BuiltinEntitySchema;
}): Promise<ListedEntity> => {
	const body: CreateEntityBody = {
		image: null,
		name: input.exercise.name,
		entitySchemaId: input.exerciseSchema.id,
		properties: { images: [], muscles: [], instructions: [], kind: input.exercise.kind },
	};
	const result = await input.deps.createEntity({ body, userId: input.userId });
	if ("error" in result) {
		throw new Error(result.message);
	}
	return result.data;
};

const findOrCreateExercise = async (input: {
	userId: string;
	exercise: WorkoutImportExercise;
	deps: WorkoutImportProcessorDeps;
	candidates: EntityMatchCandidate[];
	exerciseSchema: BuiltinEntitySchema;
	exerciseCache: Map<string, ListedEntity>;
}) => {
	const key = exerciseIdentityKey(input.exercise);
	const cached = input.exerciseCache.get(key);
	if (cached) {
		return cached;
	}

	const existing = matchExerciseCandidate(input.exercise, input.candidates);
	if (existing) {
		input.exerciseCache.set(key, existing);
		return existing;
	}

	const created = await createCustomExercise(input);
	input.exerciseCache.set(key, created);
	return created;
};

const createWorkoutEntity = async (input: {
	userId: string;
	workout: WorkoutImportItem;
	deps: WorkoutImportProcessorDeps;
	workoutSchema: BuiltinEntitySchema;
}) => {
	const properties: Record<string, unknown> = {
		startedAt: input.workout.startedAt,
	};
	if (input.workout.endedAt) {
		properties.endedAt = input.workout.endedAt;
	}
	if (input.workout.comment) {
		properties.comment = input.workout.comment;
	}

	const result = await input.deps.createEntity({
		userId: input.userId,
		body: {
			properties,
			image: null,
			name: input.workout.name,
			entitySchemaId: input.workoutSchema.id,
		},
	});
	if ("error" in result) {
		throw new Error(result.message);
	}
	return result.data;
};

const buildWorkoutSetEventDrafts = (workout: WorkoutImportItem): WorkoutSetEventDraft[] => {
	const drafts: WorkoutSetEventDraft[] = [];
	for (let exerciseOrder = 0; exerciseOrder < workout.exercises.length; exerciseOrder++) {
		const exercise = workout.exercises[exerciseOrder];
		if (!exercise) {
			continue;
		}
		for (let setOrder = 0; setOrder < exercise.sets.length; setOrder++) {
			const set = exercise.sets[setOrder];
			if (!set) {
				continue;
			}
			drafts.push({
				setOrder,
				exerciseOrder,
				properties: buildWorkoutSetEventProperties({
					set,
					setOrder,
					exerciseOrder,
					exerciseKind: exercise.kind,
				}),
			});
		}
	}
	return drafts;
};

const validateWorkoutSetEventDrafts = (input: {
	drafts: WorkoutSetEventDraft[];
	workoutSetEventSchema: BuiltinEventSchema;
}) => {
	for (const draft of input.drafts) {
		parseEventProperties({
			properties: draft.properties,
			propertiesSchema: input.workoutSetEventSchema.propertiesSchema,
		});
	}
};

const resolveWorkoutExerciseEntities = async (input: {
	userId: string;
	workout: WorkoutImportItem;
	schemas: WorkoutImportSchemas;
	deps: WorkoutImportProcessorDeps;
	candidates: EntityMatchCandidate[];
	exerciseCache: Map<string, ListedEntity>;
}): Promise<ListedEntity[]> => {
	const entities: ListedEntity[] = [];
	// oxlint-disable no-await-in-loop
	for (let exerciseOrder = 0; exerciseOrder < input.workout.exercises.length; exerciseOrder++) {
		const exercise = input.workout.exercises[exerciseOrder];
		if (!exercise) {
			continue;
		}
		const exerciseEntity = await findOrCreateExercise({
			exercise,
			deps: input.deps,
			userId: input.userId,
			candidates: input.candidates,
			exerciseCache: input.exerciseCache,
			exerciseSchema: input.schemas.exerciseSchema,
		});
		entities[exerciseOrder] = exerciseEntity;
	}
	// oxlint-enable no-await-in-loop
	return entities;
};

const buildWorkoutSetEvents = (input: {
	workout: WorkoutImportItem;
	workoutEntity: ListedEntity;
	drafts: WorkoutSetEventDraft[];
	exerciseEntities: ListedEntity[];
	workoutSetEventSchema: BuiltinEventSchema;
}): CreateEventBulkBody => {
	const events: CreateEventBulkBody = [];
	for (const draft of input.drafts) {
		const exerciseEntity = input.exerciseEntities[draft.exerciseOrder];
		if (!exerciseEntity) {
			throw new Error("Workout import is missing a resolved exercise entity");
		}
		events.push({
			entityId: exerciseEntity.id,
			properties: draft.properties,
			occurredAt: input.workout.startedAt,
			sessionEntityId: input.workoutEntity.id,
			eventSchemaId: input.workoutSetEventSchema.id,
		});
	}
	return events;
};

const commitWorkoutItem = async (input: {
	userId: string;
	workout: WorkoutImportItem;
	schemas: WorkoutImportSchemas;
	deps: WorkoutImportProcessorDeps;
	candidates: EntityMatchCandidate[];
	exerciseCache: Map<string, ListedEntity>;
}) => {
	const drafts = buildWorkoutSetEventDrafts(input.workout);
	validateWorkoutSetEventDrafts({
		drafts,
		workoutSetEventSchema: input.schemas.workoutSetEventSchema,
	});
	const exerciseEntities = await resolveWorkoutExerciseEntities(input);
	const workoutEntity = await createWorkoutEntity({
		deps: input.deps,
		userId: input.userId,
		workout: input.workout,
		workoutSchema: input.schemas.workoutSchema,
	});
	const body = buildWorkoutSetEvents({
		drafts,
		workoutEntity,
		exerciseEntities,
		workout: input.workout,
		workoutSetEventSchema: input.schemas.workoutSetEventSchema,
	});
	const result = await input.deps.createEventsWithTriggers({ body, userId: input.userId });
	if ("error" in result) {
		throw new Error(result.message);
	}
};

const recordAdapterFailures = async (input: {
	runId: string;
	failures: WorkoutAdapterFailure[];
	deps: WorkoutImportProcessorDeps;
}) => {
	// oxlint-disable no-await-in-loop
	for (const failure of input.failures) {
		await recordImportRunFailure(
			{
				runId: input.runId,
				message: failure.message,
				itemIndex: failure.itemIndex,
				stage: "input_transformation",
				sourceLabel: failure.sourceLabel,
				sourceIdentifier: failure.sourceIdentifier,
			},
			input.deps.createImportRunFailure,
		);
	}
	// oxlint-enable no-await-in-loop
};

export const processWorkoutImportResult = async (input: {
	runId: string;
	userId: string;
	adapterResult: WorkoutAdapterResult;
}): Promise<void> => processWorkoutImportResultWithDeps(input, workoutImportProcessorDeps);

export const processWorkoutImportResultWithDeps = async (
	input: {
		runId: string;
		userId: string;
		adapterResult: WorkoutAdapterResult;
	},
	deps: WorkoutImportProcessorDeps,
): Promise<void> => {
	const { items, failures } = input.adapterResult;
	const totalItems = items.length + failures.length;
	await deps.updateImportRun({ runId: input.runId, totalItems });

	let schemas: WorkoutImportSchemas;
	try {
		schemas = await loadWorkoutImportSchemas(deps);
	} catch (error) {
		await failImportRun(
			input.runId,
			sanitizeErrorMessage(error, "Workout import schemas are missing"),
			deps.updateImportRun,
		);
		return;
	}

	const candidatesResult = await deps.listEntityMatchCandidates({
		userId: input.userId,
		entitySchemaId: schemas.exerciseSchema.id,
	});
	if ("error" in candidatesResult) {
		await failImportRun(input.runId, candidatesResult.message, deps.updateImportRun);
		return;
	}

	let failedItems = 0;
	let importedItems = 0;
	let processedItems = 0;
	const exerciseCache = new Map<string, ListedEntity>();

	await recordAdapterFailures({ deps, failures, runId: input.runId });
	failedItems += failures.length;
	processedItems += failures.length;

	// oxlint-disable no-await-in-loop
	for (const workout of items) {
		try {
			await commitWorkoutItem({
				deps,
				workout,
				schemas,
				exerciseCache,
				userId: input.userId,
				candidates: candidatesResult.data,
			});
			importedItems++;
		} catch (error) {
			await recordImportRunFailure(
				{
					runId: input.runId,
					stage: "database_commit",
					entitySchemaSlug: "workout",
					itemIndex: workout.itemIndex,
					sourceLabel: workout.sourceLabel,
					sourceIdentifier: workout.sourceIdentifier,
					message: sanitizeErrorMessage(error, "Failed to import workout"),
				},
				deps.createImportRunFailure,
			);
			failedItems++;
		}

		processedItems++;
		if (processedItems % PROGRESS_UPDATE_INTERVAL === 0 || processedItems === totalItems) {
			const progress = totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 100;
			await deps.updateImportRun({
				progress,
				failedItems,
				importedItems,
				processedItems,
				runId: input.runId,
			});
		}
	}
	// oxlint-enable no-await-in-loop

	await deps.updateImportRun({
		failedItems,
		progress: 100,
		importedItems,
		processedItems,
		runId: input.runId,
		status: "completed",
		finishedAt: new Date(),
	});
};
