import { EntityId } from "@ryot-app/contract/schema/brands";
import { column, descending, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { findBuiltinSchemaBySlug } from "~/fixtures/kernel/entity-schemas";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { pollUntil } from "~/fixtures/kernel/polling";
import {
	executeRyotQL,
	requireRows,
	requireRyotQLText,
	requireRyotQLValue,
} from "~/fixtures/kernel/ryotql";
import { requireObjectRecord, requireString } from "~/support/assertions";

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
				const properties = requireRyotQLValue(item, "properties");
				return {
					entityId: EntityId.make(requireRyotQLText(item, "entityId")),
					sessionEntityId: EntityId.make(requireRyotQLText(item, "sessionEntityId")),
					properties: requireObjectRecord(properties, "Session event properties must be an object"),
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
			const ids = exercises.items.map((item) => EntityId.make(requireRyotQLText(item, "id")));

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
