import { requireString } from "../test-support/assertions";
import type { Client } from "./auth";
import { createEntity } from "./entities";
import { findBuiltinSchemaBySlug } from "./entity-schemas";
import { listEventSchemas, requireEventSchemaBySlug } from "./event-schemas";
import { type PollOptions, pollUntil } from "./polling";
import {
	buildTableDisplayConfiguration,
	buildTableRequest,
	executeQueryEngine,
} from "./query-engine";
import { entityField } from "./view-language";

export async function createWorkoutEntityFixture(client: Client) {
	const { schema: workoutSchema } = await findBuiltinSchemaBySlug(client, "workout");

	const workout = await createEntity(client, {
		image: null,
		entitySchemaId: workoutSchema.id,
		name: `Workout ${crypto.randomUUID()}`,
		properties: {
			endedAt: "2026-04-27T11:00:00Z",
			startedAt: "2026-04-27T10:00:00Z",
		},
	});

	return { workoutId: workout.id };
}

export async function findWorkoutSetEventSchema(client: Client) {
	const { schema: exerciseSchema } = await findBuiltinSchemaBySlug(client, "exercise");
	const eventSchemas = await listEventSchemas(client, exerciseSchema.id);
	const workoutSetEventSchema = requireEventSchemaBySlug(eventSchemas, "workout-set");

	return { workoutSetEventSchema };
}

export async function waitForSessionEventCount(
	client: Client,
	sessionEntityId: string,
	expectedCount: number,
	options: PollOptions = {},
) {
	return pollUntil(
		`${expectedCount} events on session ${sessionEntityId}`,
		async () => {
			const events = await client.run((c) => c.events.list({ urlParams: { sessionEntityId } }));
			return events.length >= expectedCount ? events : null;
		},
		{ timeoutMs: 5000, intervalMs: 200, ...options },
	);
}

async function pollSeededExerciseIds(client: Client, count: number) {
	return pollUntil(
		count === 1 ? "seeded exercise id to be queryable" : "seeded exercise ids to be queryable",
		async () => {
			const result = await executeQueryEngine(
				client,
				buildTableRequest({
					scope: ["exercise"],
					pagination: { page: 1, limit: count },
					displayConfiguration: buildTableDisplayConfiguration([
						{ label: "Id", property: [entityField("exercise", "id")] },
					]),
				}),
			);

			const ids = result.data.data.items.flatMap((item) => {
				const field = item.column_0;
				if (field?.kind !== "text") {
					return [];
				}

				return [requireString(field.value, "Expected seeded exercise id to be text")];
			});

			return ids.length >= count ? ids.slice(0, count) : null;
		},
		{ intervalMs: 1000, timeoutMs: 60000 },
	);
}

export async function waitForSeededExerciseId(client: Client) {
	const ids = await pollSeededExerciseIds(client, 1);
	return requireString(ids[0], "Expected at least one seeded exercise id");
}

export async function waitForSeededExerciseIds(client: Client, count: number) {
	return pollSeededExerciseIds(client, count);
}
