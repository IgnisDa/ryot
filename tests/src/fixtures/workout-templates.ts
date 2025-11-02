import { getPgClient } from "../setup";
import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import { createEntity } from "./entities";
import { findBuiltinSchemaBySlug } from "./entity-schemas";
import { waitForSeededExerciseId } from "./workouts";

export async function findBuiltinRelationshipSchemaId(slug: string) {
	const pg = getPgClient();
	const result = await pg.query<{ id: string }>(
		`select id
		 from relationship_schema
		 where slug = $1
		   and user_id is null
		   and is_builtin = true
		 limit 1`,
		[slug],
	);
	const id = result.rows[0]?.id;
	return requirePresent(id, `Builtin relationship schema '${slug}' not found`);
}

export async function createWorkoutTemplateEntityFixture(
	client: Client,
	cookies: string,
	options: { name?: string; comment?: string; exerciseId?: string } = {},
) {
	const { schema: workoutTemplateSchema } = await findBuiltinSchemaBySlug(
		client,
		cookies,
		"workout-template",
	);
	const exerciseId = options.exerciseId ?? (await waitForSeededExerciseId(client, cookies));
	const workoutTemplate = await createEntity(client, cookies, {
		image: null,
		entitySchemaId: workoutTemplateSchema.id,
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
}
