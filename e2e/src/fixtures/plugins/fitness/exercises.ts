import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { findBuiltinSchemaBySlug } from "~/fixtures/kernel/entity-schemas";

type ExerciseKind =
	| "reps"
	| "duration"
	| "reps_and_weight"
	| "reps_and_duration"
	| "distance_and_duration"
	| "reps_and_duration_and_distance";

export const createExerciseEntityFixture = (
	client: Client,
	options: { name?: string; kind?: ExerciseKind } = {},
) =>
	Effect.gen(function* () {
		const { schema: exerciseSchema } = yield* findBuiltinSchemaBySlug(client, "exercise");
		const exercise = yield* createEntity(client, {
			entitySchemaSlug: exerciseSchema.id,
			name: options.name ?? `Exercise ${crypto.randomUUID()}`,
			properties: {
				level: "beginner",
				equipment: "body_only",
				muscles: ["abdominals"],
				kind: options.kind ?? "reps_and_weight",
				images: [{ type: "remote", url: "https://example.com/exercise.jpg" }],
			},
		});

		return { exercise, exerciseId: exercise.id };
	});
