import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { findBuiltinSchemaBySlug } from "~/fixtures/kernel/entity-schemas";
import {
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
} from "~/fixtures/kernel/relationship-schemas";
import { requirePresent } from "~/support/assertions";

import { createExerciseEntityFixture } from "./exercises";

export const findBuiltinRelationshipSchemaSlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const schemas = yield* listRelationshipSchemas(client, { slugs: [slug] });
		const schema = requireRelationshipSchemaBySlug(schemas, slug);
		return requirePresent(
			schema.isBuiltin ? schema.id : null,
			`Builtin relationship schema '${slug}' not found`,
		);
	});

export const createWorkoutTemplateEntityFixture = (
	client: Client,
	options: { name?: string; comment?: string; exerciseId?: string } = {},
) =>
	Effect.gen(function* () {
		const { schema: workoutTemplateSchema } = yield* findBuiltinSchemaBySlug(
			client,
			"workout-template",
		);
		const exerciseId =
			options.exerciseId ?? (yield* createExerciseEntityFixture(client)).exerciseId;
		const workoutTemplate = yield* createEntity(client, {
			entitySchemaSlug: workoutTemplateSchema.id,
			name: options.name ?? `Workout Template ${crypto.randomUUID()}`,
			properties: {
				comment: options.comment ?? "Upper body template",
				supersets: [{ exercises: [0], color: "#84CC16" }],
				exercises: [
					{
						exerciseId,
						exerciseOrder: 0,
						notes: ["Keep the movement controlled"],
						sets: [
							{
								rpe: 7,
								reps: 10,
								weight: 60,
								setOrder: 0,
								distance: null,
								duration: null,
								setLot: "normal",
								note: "Main working set",
							},
						],
					},
				],
			},
		});

		return { workoutTemplate, workoutTemplateId: workoutTemplate.id };
	});
