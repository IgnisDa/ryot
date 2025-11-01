import { EntityId } from "@ryot/app-backend/schema/brands";

import { requireString } from "../test-support/assertions";
import type { Client } from "./auth";
import { createEntity } from "./entities";
import { findBuiltinSchemaBySlug } from "./entity-schemas";
import { listEventSchemas, requireEventSchemaBySlug } from "./event-schemas";
import { type PollOptions, pollUntil } from "./polling";
import {
	buildEntityRowsQueryDocument,
	executeQueryEngine,
	requireQueryEngineFieldValue,
	systemRef,
} from "./query-engine-core";

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
			const events = await client.run((c) =>
				c.events.list({ urlParams: { sessionEntityId: EntityId.make(sessionEntityId) } }),
			);
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
				buildEntityRowsQueryDocument({
					limit: count,
					alias: "exercise",
					schemas: ["exercise"],
					fields: [{ key: "id", expr: systemRef("exercise", "id") }],
				}),
			);

			const ids = result.data.items.flatMap((item) => {
				const field = requireQueryEngineFieldValue(item, "id");
				if (field.kind !== "text") {
					return [];
				}

				return [
					EntityId.make(requireString(field.value, "Expected seeded exercise id to be text")),
				];
			});

			return ids.length >= count ? ids.slice(0, count) : null;
		},
		{ intervalMs: 1000, timeoutMs: 60000 },
	);
}

export async function waitForSeededExerciseId(client: Client) {
	const ids = await pollSeededExerciseIds(client, 1);
	return EntityId.make(requireString(ids[0], "Expected at least one seeded exercise id"));
}

export async function waitForSeededExerciseIds(client: Client, count: number) {
	return pollSeededExerciseIds(client, count);
}
