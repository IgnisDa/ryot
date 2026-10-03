import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect } from "effect";

import { waitForCreateEvents } from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";

import { findFitnessEntitySchema } from "./exercises";
import { findWorkoutSetEventSchema } from "./workouts";

export const seedExerciseWorkout = (
	client: Client,
	input: {
		exerciseId: EntityId;
		name: string;
		startedAt: string;
		endedAt: string;
		exerciseNotes?: JsonValue;
		sets: ReadonlyArray<{ occurredAt: string; properties: Record<string, JsonValue> }>;
	},
) =>
	Effect.gen(function* () {
		const { schema: workoutSchema } = yield* findFitnessEntitySchema(client, "workout");
		const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
		const workout = yield* createEntity(client, {
			name: input.name,
			entitySchema: workoutSchema.reference,
			properties: {
				endedAt: input.endedAt,
				startedAt: input.startedAt,
				...(input.exerciseNotes === undefined ? {} : { exerciseNotes: input.exerciseNotes }),
			},
		});
		const response = yield* client.call((c) =>
			c.events.create({
				payload: input.sets.map((set, index) => ({
					entityId: input.exerciseId,
					occurredAt: set.occurredAt,
					sessionEntityId: workout.id,
					eventSchemaSlug: workoutSetEventSchema.id,
					properties: { setOrder: index, exerciseOrder: 0, ...set.properties },
				})),
			}),
		);
		yield* waitForCreateEvents(client, response);
		return { workoutId: workout.id };
	});
