import { DateTime, Effect, Either } from "effect";

import type { CurrentUserValue } from "~/lib/auth";
import { DbRunner } from "~/lib/db";
import { badRequest } from "~/lib/errors";
import { parseAppSchemaPropertiesSafe } from "~/lib/property-schema-runtime";
import type { AppSchema } from "~/lib/schema";
import { EntitiesRepository } from "~/modules/entities/repository";
import type { ListedEntity } from "~/modules/entities/schemas";
import { EntitiesService } from "~/modules/entities/service";
import { EntitySchemasRepository } from "~/modules/entity-schemas/repository";
import { EventSchemasRepository } from "~/modules/event-schemas/repository";
import type { CreateEventItem } from "~/modules/events/schemas";
import { EventsService } from "~/modules/events/service";

import { ImportsRepository } from "../repository";
import {
	PROGRESS_UPDATE_INTERVAL,
	failImportRun,
	recordImportRunFailure,
	sanitizeErrorMessage,
} from "../runtime/failures";
import {
	buildWorkoutSetEventProperties,
	normalizeExerciseIdentityName,
	type WorkoutAdapterResult,
	type WorkoutImportExercise,
	type WorkoutImportItem,
} from "./domain";

type WorkoutSchemas = {
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

const findOrCreateExercise = (input: {
	user: CurrentUserValue;
	exerciseSchemaId: string;
	entities: EntitiesService;
	exercise: WorkoutImportExercise;
	candidates: ReadonlyArray<ListedEntity>;
	exerciseCache: Map<string, ListedEntity>;
}) =>
	Effect.gen(function* () {
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

const commitWorkoutItem = (input: {
	events: EventsService;
	user: CurrentUserValue;
	schemas: WorkoutSchemas;
	entities: EntitiesService;
	workout: WorkoutImportItem;
	candidates: ReadonlyArray<ListedEntity>;
	exerciseCache: Map<string, ListedEntity>;
}) =>
	Effect.gen(function* () {
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

		return yield* input.events.createForImport(input.user.id, eventBody);
	});

export const processWorkoutImportResult = (input: {
	runId: string;
	userId: string;
	adapterResult: WorkoutAdapterResult;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const events = yield* EventsService;
		const entities = yield* EntitiesService;
		const repository = yield* ImportsRepository;
		const eventSchemas = yield* EventSchemasRepository;
		const entitySchemas = yield* EntitySchemasRepository;
		const entitiesRepository = yield* EntitiesRepository;

		const user: CurrentUserValue = { id: input.userId, name: "", email: "" };
		const { items, failures } = input.adapterResult;
		const totalItems = items.length + failures.length;
		yield* runWithDb(repository.updateRun({ runId: input.runId, totalItems }));

		const exerciseSchema = yield* runWithDb(entitySchemas.getBuiltinBySlug("exercise"));
		const workoutSchema = yield* runWithDb(entitySchemas.getBuiltinBySlug("workout"));
		if (!exerciseSchema || !workoutSchema) {
			yield* failImportRun(input.runId, "Workout import schemas are missing");
			return;
		}

		const workoutSetEventSchema = yield* runWithDb(
			eventSchemas.getBuiltinBySlug({ entitySchemaId: exerciseSchema.id, slug: "workout-set" }),
		);
		if (!workoutSetEventSchema) {
			yield* failImportRun(input.runId, "Workout import schemas are missing");
			return;
		}

		const schemas: WorkoutSchemas = {
			workoutSchemaId: workoutSchema.id,
			exerciseSchemaId: exerciseSchema.id,
			workoutSetEventSchemaId: workoutSetEventSchema.id,
			workoutSetEventPropertiesSchema: workoutSetEventSchema.propertiesSchema,
		};

		const candidates = yield* runWithDb(
			entitiesRepository.listMatchCandidatesBySchema({
				userId: input.userId,
				entitySchemaId: exerciseSchema.id,
			}),
		);

		let failedItems = 0;
		let importedItems = 0;
		let processedItems = 0;
		const exerciseCache = new Map<string, ListedEntity>();

		for (const failure of failures) {
			yield* recordImportRunFailure({
				runId: input.runId,
				message: failure.message,
				itemIndex: failure.itemIndex,
				stage: "input_transformation",
				sourceLabel: failure.sourceLabel,
				sourceIdentifier: failure.sourceIdentifier,
			});
		}
		failedItems += failures.length;
		processedItems += failures.length;

		for (const workout of items) {
			const result = yield* commitWorkoutItem({
				user,
				events,
				schemas,
				workout,
				entities,
				candidates,
				exerciseCache,
			}).pipe(Effect.either);

			if (Either.isRight(result)) {
				importedItems++;
			} else {
				yield* recordImportRunFailure({
					runId: input.runId,
					stage: "database_commit",
					entitySchemaSlug: "workout",
					itemIndex: workout.itemIndex,
					sourceLabel: workout.sourceLabel,
					sourceIdentifier: workout.sourceIdentifier,
					message: sanitizeErrorMessage(result.left, "Failed to import workout"),
				});
				failedItems++;
			}

			processedItems++;
			if (processedItems % PROGRESS_UPDATE_INTERVAL === 0 || processedItems === totalItems) {
				const progress = totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 100;
				yield* runWithDb(
					repository.updateRun({
						progress,
						failedItems,
						importedItems,
						processedItems,
						runId: input.runId,
					}),
				);
			}
		}

		const finishedAt = yield* DateTime.nowAsDate;
		yield* runWithDb(
			repository.updateRun({
				finishedAt,
				failedItems,
				progress: 100,
				importedItems,
				processedItems,
				runId: input.runId,
				status: "completed",
			}),
		);
	});
