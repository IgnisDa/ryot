import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity, getEntity } from "~/fixtures/kernel/entities";
import { waitForCreateEvents } from "~/fixtures/kernel/events";
import { requirePresent } from "~/support/assertions";

import { findWorkoutExerciseEventSchema } from "./analytics-evidence";
import { findFitnessEntitySchema } from "./exercises";
import { findWorkoutSetEventSchema } from "./workouts";

export const seedExerciseWorkout = (
	client: Client,
	input: {
		name: string;
		endedAt?: string;
		startedAt: string;
		timeoutMs?: number;
		exerciseId: EntityId;
		exerciseNotes?: JsonValue;
		properties?: Record<string, JsonValue>;
		sets: ReadonlyArray<{ occurredAt: string; properties: Record<string, JsonValue> }>;
	},
) =>
	Effect.gen(function* () {
		const { schema: workoutSchema } = yield* findFitnessEntitySchema(client, "workout");
		const workout = yield* createEntity(client, {
			name: input.name,
			entitySchema: workoutSchema.reference,
			properties: {
				startedAt: input.startedAt,
				...(input.endedAt === undefined ? {} : { endedAt: input.endedAt }),
				...input.properties,
				...(input.exerciseNotes === undefined ? {} : { exerciseNotes: input.exerciseNotes }),
			},
		});
		if (input.sets.length === 0) {
			return { created: { count: 0 }, workoutId: workout.id };
		}
		const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
		const workoutExerciseEventSchema = yield* findWorkoutExerciseEventSchema(client);
		const exercise = yield* getEntity(client, input.exerciseId);
		const exerciseKind = requirePresent(exercise.properties["kind"], "Expected the exercise kind");
		const response = yield* client.call((c) =>
			c.events.create({
				payload: [
					{
						entityId: input.exerciseId,
						sessionEntityId: workout.id,
						occurredAt: input.startedAt,
						eventSchemaSlug: workoutExerciseEventSchema.id,
						properties: {
							targets: [],
							exerciseKind,
							equipment: [],
							exerciseOrder: 0,
							provenance: "recorded",
						},
					},
					...input.sets.map((set, setOrder) => ({
						entityId: input.exerciseId,
						occurredAt: set.occurredAt,
						sessionEntityId: workout.id,
						eventSchemaSlug: workoutSetEventSchema.id,
						properties: { setOrder, exerciseKind, exerciseOrder: 0, ...set.properties },
					})),
				],
			}),
		);
		const created = yield* waitForCreateEvents(client, response, input.timeoutMs);
		return { workoutId: workout.id, created: { count: created.count - 1 } };
	});
