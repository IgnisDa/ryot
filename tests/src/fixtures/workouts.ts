import { EntityId } from "@ryot/contract/schema/brands";
import { column, descending, document, eq, field, literal, rows, table } from "@ryot/ryotql";
import { Effect } from "effect";

import { requireObjectRecord, requireString } from "~/support/assertions";

import type { Client } from "./auth";
import { createEntity } from "./entities";
import { findBuiltinSchemaBySlug } from "./entity-schemas";
import { listEventSchemas, requireEventSchemaBySlug } from "./event-schemas";
import { pollUntil } from "./polling";
import {
	executeRyotQL,
	requireRows,
	requireRyotQLFieldValue,
	requireRyotQLTextField,
} from "./ryotql";

export const createWorkoutEntityFixture = (client: Client) =>
	Effect.gen(function* () {
		const { schema: workoutSchema } = yield* findBuiltinSchemaBySlug(client, "workout");

		const workout = yield* createEntity(client, {
			entitySchemaSlug: workoutSchema.id,
			name: `Workout ${crypto.randomUUID()}`,
			properties: {
				endedAt: "2026-04-27T11:00:00Z",
				startedAt: "2026-04-27T10:00:00Z",
			},
		});

		return { workoutId: workout.id };
	});

export const findWorkoutSetEventSchema = (client: Client) =>
	Effect.gen(function* () {
		const { schema: exerciseSchema } = yield* findBuiltinSchemaBySlug(client, "exercise");
		const eventSchemas = yield* listEventSchemas(client, exerciseSchema.id);
		const workoutSetEventSchema = requireEventSchemaBySlug(eventSchemas, "workout-set");

		return { workoutSetEventSchema };
	});

export const waitForSessionEventCount = (
	client: Client,
	sessionEntityId: string,
	expectedCount: number,
) =>
	pollUntil(
		`${expectedCount} events on session ${sessionEntityId}`,
		Effect.gen(function* () {
			const event = table("event", "event");
			const result = yield* executeRyotQL(
				client,
				document({
					events: rows(event, {
						limit: 100,
						where: eq(column(event, "sessionEntityId"), literal(sessionEntityId)),
						orderBy: [
							descending(column(event, "occurredAt")),
							descending(column(event, "createdAt")),
							descending(column(event, "id")),
						],
						fields: [
							field("entityId", column(event, "entityId")),
							field("sessionEntityId", column(event, "sessionEntityId")),
							field("properties", column(event, "properties")),
						],
					}),
				}),
			);
			const eventRows = requireRows(result.data.events, "events");
			const events = eventRows.items.map((item) => {
				const properties = requireRyotQLFieldValue(item, "properties");
				if (properties.kind !== "json") {
					throw new Error("Expected session event properties to be JSON");
				}
				return {
					entityId: EntityId.make(requireRyotQLTextField(item, "entityId")),
					sessionEntityId: EntityId.make(requireRyotQLTextField(item, "sessionEntityId")),
					properties: requireObjectRecord(
						properties.value,
						"Session event properties must be an object",
					),
				};
			});
			return events.length >= expectedCount ? events : null;
		}),
	);

const pollSeededExerciseIds = (client: Client, count: number) =>
	pollUntil(
		count === 1 ? "seeded exercise id to be queryable" : "seeded exercise ids to be queryable",
		Effect.gen(function* () {
			const entity = table("entity", "exercise");
			const result = yield* executeRyotQL(
				client,
				document({
					exercises: rows(entity, {
						limit: count,
						fields: [field("id", column(entity, "id"))],
						where: eq(column(entity, "entitySchemaSlug"), literal("exercise")),
					}),
				}),
			);

			const exercises = result.data.exercises;
			if (exercises?.type !== "rows") {
				return null;
			}
			const ids = exercises.items.map((item) => EntityId.make(requireRyotQLTextField(item, "id")));

			return ids.length >= count ? ids.slice(0, count) : null;
		}),
	);

export const waitForSeededExerciseId = (client: Client) =>
	Effect.gen(function* () {
		const ids = yield* pollSeededExerciseIds(client, 1);
		return EntityId.make(requireString(ids[0], "Expected at least one seeded exercise id"));
	});

export const waitForSeededExerciseIds = (client: Client, count: number) =>
	pollSeededExerciseIds(client, count);
