import type { ExerciseKind } from "@ryot-app/fitness-plugin/exercise-kinds";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { findBuiltinSchemaBySlug } from "~/fixtures/kernel/entity-schemas";

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
				kind: options.kind ?? "reps_and_weight",
				images: [{ type: "remote", url: "https://example.com/exercise.jpg" }],
			},
		});

		return { exercise, exerciseId: exercise.id };
	});
