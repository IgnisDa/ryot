import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest } from "@ryot/contract/errors";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type { CreateEventItem } from "@ryot/contract/modules/events/schemas";
import type { EntitySchemaId, EventSchemaId, UserId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaPropertiesSafe } from "#lib/property-schema/property-schema-runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

import {
	buildWorkoutSetEventProperties,
	normalizeExerciseIdentityName,
	type WorkoutImportExercise,
	type WorkoutImportItem,
} from "./domain";

export type WorkoutSchemas = {
	workoutSchemaId: EntitySchemaId;
	exerciseSchemaId: EntitySchemaId;
	workoutSetEventSchemaId: EventSchemaId;
	workoutSetEventPropertiesSchema: AppSchema;
};

const exerciseIdentityKey = (input: { name: string; kind: string }): string =>
	`${normalizeExerciseIdentityName(input.name)}|${input.kind}`;

const matchExerciseCandidate = (
	exercise: WorkoutImportExercise,
	candidates: ReadonlyArray<ListedEntity>,
): ListedEntity | undefined => {
	const key = exerciseIdentityKey(exercise);
	return candidates.find((candidate) => {
		const kind = isObjectRecord(candidate.properties) ? candidate.properties["kind"] : undefined;
		return typeof kind === "string" && exerciseIdentityKey({ kind, name: candidate.name }) === key;
	});
};

const findOrCreateExercise = Effect.fn(function* (input: {
	user: CurrentUserValue;
	exercise: WorkoutImportExercise;
	exerciseSchemaId: EntitySchemaId;
	candidates: ReadonlyArray<ListedEntity>;
	exerciseCache: Map<string, ListedEntity>;
}) {
	const entities = yield* EntitiesService;
	const key = exerciseIdentityKey(input.exercise);
	const cached = input.exerciseCache.get(key);
	if (cached) {
		return { entity: cached, created: false };
	}

	const existing = matchExerciseCandidate(input.exercise, input.candidates);
	if (existing) {
		input.exerciseCache.set(key, existing);
		return { entity: existing, created: false };
	}

	const { entity: created, operation } = yield* entities.create(input.user.id, {
		name: input.exercise.name,
		entitySchemaId: input.exerciseSchemaId,
		properties: { images: [], muscles: [], instructions: [], kind: input.exercise.kind },
	});
	input.exerciseCache.set(key, created);
	return { entity: created, created: operation === "create" };
});

const buildWorkoutEntityProperties = (workout: WorkoutImportItem): Record<string, unknown> => {
	const properties: Record<string, unknown> = { startedAt: workout.startedAt };
	if (workout.endedAt) {
		properties["endedAt"] = workout.endedAt;
	}
	if (workout.comment) {
		properties["comment"] = workout.comment;
	}
	return properties;
};

export type WorkoutEntityMutation = {
	entity: ListedEntity;
	entitySchemaSlug: "exercise" | "workout";
};

export type CommitWorkoutItemResult = {
	events: CreateEventItem[];
	entityMutations: WorkoutEntityMutation[];
};

export const commitWorkoutItem = Effect.fn("imports.commitWorkoutItem")(function* (input: {
	user: CurrentUserValue;
	schemas: WorkoutSchemas;
	workout: WorkoutImportItem;
	candidates: ReadonlyArray<ListedEntity>;
	exerciseCache: Map<string, ListedEntity>;
}) {
	const entities = yield* EntitiesService;
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

	const entityMutations: WorkoutEntityMutation[] = [];
	const exerciseEntities: ListedEntity[] = [];
	for (let exerciseOrder = 0; exerciseOrder < input.workout.exercises.length; exerciseOrder++) {
		const exercise = input.workout.exercises[exerciseOrder];
		if (!exercise) {
			continue;
		}
		const resolved = yield* findOrCreateExercise({
			exercise,
			user: input.user,
			candidates: input.candidates,
			exerciseCache: input.exerciseCache,
			exerciseSchemaId: input.schemas.exerciseSchemaId,
		});
		exerciseEntities[exerciseOrder] = resolved.entity;
		if (resolved.created) {
			entityMutations.push({ entitySchemaSlug: "exercise", entity: resolved.entity });
		}
	}

	const { entity: workoutEntity, operation: workoutOperation } = yield* entities.create(
		input.user.id,
		{
			name: input.workout.name,
			entitySchemaId: input.schemas.workoutSchemaId,
			properties: buildWorkoutEntityProperties(input.workout),
		},
	);
	if (workoutOperation === "create") {
		entityMutations.push({ entitySchemaSlug: "workout", entity: workoutEntity });
	}

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

	return { events: eventBody, entityMutations } satisfies CommitWorkoutItemResult;
});

export type WorkoutImportContext = {
	schemas: WorkoutSchemas;
	candidates: ReadonlyArray<ListedEntity>;
};

export const loadWorkoutImportContext = Effect.fn("imports.loadWorkoutImportContext")(function* (
	userId: UserId,
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
