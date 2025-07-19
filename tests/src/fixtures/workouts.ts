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

export async function createWorkoutEntityFixture(client: Client, cookies: string) {
	const { schema: workoutSchema } = await findBuiltinSchemaBySlug(client, cookies, "workout");

	const workout = await createEntity(client, cookies, {
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

export async function findWorkoutSetEventSchema(client: Client, cookies: string) {
	const { schema: exerciseSchema } = await findBuiltinSchemaBySlug(client, cookies, "exercise");
	const eventSchemas = await listEventSchemas(client, cookies, exerciseSchema.id);
	const workoutSetEventSchema = requireEventSchemaBySlug(eventSchemas, "workout-set");

	return { workoutSetEventSchema };
}

export async function waitForSessionEventCount(
	client: Client,
	cookies: string,
	sessionEntityId: string,
	expectedCount: number,
	options: PollOptions = {},
) {
	return pollUntil(
		`${expectedCount} events on session ${sessionEntityId}`,
		async () => {
			const result = await client.GET("/events", {
				headers: { Cookie: cookies },
				params: { query: { sessionEntityId } },
			});
			const events = result.data?.data ?? [];
			return events.length >= expectedCount ? events : null;
		},
		{ timeoutMs: 5000, intervalMs: 200, ...options },
	);
}

export async function waitForSeededExerciseId(client: Client, cookies: string) {
	return pollUntil(
		"seeded exercise id to be queryable",
		async () => {
			const result = await executeQueryEngine(
				client,
				cookies,
				buildTableRequest({
					scope: ["exercise"],
					pagination: { page: 1, limit: 1 },
					displayConfiguration: buildTableDisplayConfiguration([
						{ label: "Id", property: [entityField("exercise", "id")] },
					]),
				}),
			);

			if (result.response.status !== 200) {
				return null;
			}

			const idField = result.data?.data.items[0]?.find(
				(field) => field.key === "column_0" && field.kind === "text",
			);
			return typeof idField?.value === "string" ? idField.value : null;
		},
		{ intervalMs: 1000, timeoutMs: 60000 },
	);
}
