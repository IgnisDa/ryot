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
		const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
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
		const created = yield* waitForCreateEvents(client, response, input.timeoutMs);
		return { created, workoutId: workout.id };
	});
