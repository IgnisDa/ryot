import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import {
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
} from "~/fixtures/kernel/relationship-schemas";

import {
	createExerciseEntityFixture,
	findFitnessEntitySchema,
	fitnessFixtureInstallation,
} from "./exercises";

export const findFitnessRelationshipSchema = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const owner = definitionOwner((yield* fitnessFixtureInstallation(client.target)).id);
		const schemas = yield* listRelationshipSchemas(client, { owner, slugs: [slug] });
		return requireRelationshipSchemaBySlug(schemas, slug, owner);
	});

export const createWorkoutTemplateEntityFixture = (
	client: Client,
	options: { name?: string; comment?: string; exerciseId?: string } = {},
) =>
	Effect.gen(function* () {
		const { schema: workoutTemplateSchema } = yield* findFitnessEntitySchema(
			client,
			"workout-template",
		);
		const exerciseId =
			options.exerciseId ?? (yield* createExerciseEntityFixture(client)).exerciseId;
		const workoutTemplate = yield* createEntity(client, {
			entitySchema: workoutTemplateSchema.reference,
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
