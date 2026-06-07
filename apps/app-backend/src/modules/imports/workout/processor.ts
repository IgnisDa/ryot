import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { DbRunner } from "#lib/db";
import { badRequest } from "#lib/errors";
import { parseAppSchemaPropertiesSafe } from "#lib/schema/core";
import type { AppSchema } from "#lib/schema/core";
import { EntitiesRepository } from "#modules/entities/repository";
import type { ListedEntity } from "#modules/entities/schemas";
import type { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import type { CreateEventItem } from "#modules/events/schemas";
import type { EventsService } from "#modules/events/service";

import {
	buildWorkoutSetEventProperties,
	normalizeExerciseIdentityName,
	type WorkoutImportExercise,
	type WorkoutImportItem,
} from "./domain";

export type WorkoutSchemas = {
	workoutSchemaId: string;
	exerciseSchemaId: string;
	workoutSetEventSchemaId: string;
	workoutSetEventPropertiesSchema: AppSchema;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const exerciseIdentityKey = (input: { name: string; kind: string }): string =>
	`${normalizeExerciseIdentityName(input.name)}|${input.kind}`;

const matchExerciseCandidate = (
	exercise: WorkoutImportExercise,
	candidates: ReadonlyArray<ListedEntity>,
): ListedEntity | undefined => {
	const key = exerciseIdentityKey(exercise);
	return candidates.find((candidate) => {
		const kind = isRecord(candidate.properties) ? candidate.properties.kind : undefined;
		return typeof kind === "string" && exerciseIdentityKey({ kind, name: candidate.name }) === key;
	});
};

const findOrCreateExercise = Effect.fn(function* (input: {
	user: CurrentUserValue;
	exerciseSchemaId: string;
	entities: EntitiesService;
	exercise: WorkoutImportExercise;
	candidates: ReadonlyArray<ListedEntity>;
	exerciseCache: Map<string, ListedEntity>;
}) {
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

	const created = yield* input.entities.create(input.user, {
		name: input.exercise.name,
		entitySchemaId: input.exerciseSchemaId,
		properties: { images: [], muscles: [], instructions: [], kind: input.exercise.kind },
	});
	input.exerciseCache.set(key, created);
	return created;
});

const buildWorkoutEntityProperties = (workout: WorkoutImportItem): Record<string, unknown> => {
	const properties: Record<string, unknown> = { startedAt: workout.startedAt };
	if (workout.endedAt) {
		properties.endedAt = workout.endedAt;
	}
	if (workout.comment) {
		properties.comment = workout.comment;
	}
	return properties;
};

export const commitWorkoutItem = Effect.fn("imports.commitWorkoutItem")(function* (input: {
	runId: string;
	events: EventsService;
	user: CurrentUserValue;
	schemas: WorkoutSchemas;
	entities: EntitiesService;
	workout: WorkoutImportItem;
	candidates: ReadonlyArray<ListedEntity>;
	exerciseCache: Map<string, ListedEntity>;
}) {
	const drafts = input.workout.exercises.flatMap((exercise, exerciseOrder) =>
		exercise.sets.map((set, setOrder) => ({
			exerciseOrder,
			properties: buildWorkoutSetEventProperties({
				set,
				setOrder,
				exerciseOrder,
				exerciseKind: exercise.kind,
			}),
		})),
	);

	for (const draft of drafts) {
		const validation = parseAppSchemaPropertiesSafe({
			kind: "Event",
			properties: draft.properties,
			propertiesSchema: input.schemas.workoutSetEventPropertiesSchema,
		});
		if (!validation.success) {
			return yield* badRequest("Invalid workout set event properties");
		}
	}

	const exerciseEntities: ListedEntity[] = [];
	for (let exerciseOrder = 0; exerciseOrder < input.workout.exercises.length; exerciseOrder++) {
		const exercise = input.workout.exercises[exerciseOrder];
		if (!exercise) {
			continue;
		}
		exerciseEntities[exerciseOrder] = yield* findOrCreateExercise({
			exercise,
			user: input.user,
			entities: input.entities,
			candidates: input.candidates,
			exerciseCache: input.exerciseCache,
			exerciseSchemaId: input.schemas.exerciseSchemaId,
		});
	}

	const workoutEntity = yield* input.entities.create(input.user, {
		name: input.workout.name,
		entitySchemaId: input.schemas.workoutSchemaId,
		properties: buildWorkoutEntityProperties(input.workout),
	});

	const eventBody: CreateEventItem[] = [];
	for (const draft of drafts) {
		const exerciseEntity = exerciseEntities[draft.exerciseOrder];
		if (!exerciseEntity) {
			return yield* badRequest("Workout import is missing a resolved exercise entity");
		}
		eventBody.push({
			entityId: exerciseEntity.id,
			properties: draft.properties,
			sessionEntityId: workoutEntity.id,
			occurredAt: input.workout.startedAt,
			eventSchemaId: input.schemas.workoutSetEventSchemaId,
		});
	}

	return yield* input.events.createForImport(input.user.id, eventBody, input.runId);
});

export type WorkoutImportContext = {
	schemas: WorkoutSchemas;
	candidates: ReadonlyArray<ListedEntity>;
};

export const loadWorkoutImportContext = Effect.fn("imports.loadWorkoutImportContext")(function* (
	userId: string,
) {
	const runWithDb = yield* DbRunner;
	const eventSchemas = yield* EventSchemasRepository;
	const entitySchemas = yield* EntitySchemasRepository;
	const entitiesRepository = yield* EntitiesRepository;

	const exerciseSchema = yield* runWithDb(entitySchemas.getBuiltinBySlug("exercise"));
	const workoutSchema = yield* runWithDb(entitySchemas.getBuiltinBySlug("workout"));
	if (!exerciseSchema || !workoutSchema) {
		return null;
	}

	const workoutSetEventSchema = yield* runWithDb(
		eventSchemas.getBuiltinBySlug({ entitySchemaId: exerciseSchema.id, slug: "workout-set" }),
	);
	if (!workoutSetEventSchema) {
		return null;
	}

	const candidates = yield* runWithDb(
		entitiesRepository.listMatchCandidatesBySchema({
			userId,
			entitySchemaId: exerciseSchema.id,
		}),
	);

	return {
		candidates,
		schemas: {
			workoutSchemaId: workoutSchema.id,
			exerciseSchemaId: exerciseSchema.id,
			workoutSetEventSchemaId: workoutSetEventSchema.id,
			workoutSetEventPropertiesSchema: workoutSetEventSchema.propertiesSchema,
		},
	} satisfies WorkoutImportContext;
});
