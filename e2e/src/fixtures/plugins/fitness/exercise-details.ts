import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { WorkoutEditorSaveInputSchema } from "@ryot-app/fitness-plugin/workout-editor-operations";
import { DateTime, Effect, Schema } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity, getEntity } from "~/fixtures/kernel/entities";
import { waitForCreateEvents } from "~/fixtures/kernel/events";
import { assertCondition } from "~/support/assertions";

import { findFitnessEntitySchema } from "./exercises";
import { saveWorkoutData, workoutData, workoutOccurrence, workoutSet } from "./workout-editor";
import { findWorkoutSetEventSchema } from "./workouts";

export const seedExerciseWorkout = (
	client: Client,
	input: {
		name: string;
		endedAt?: string;
		startedAt: string;
		timeoutMs?: number;
		exerciseId: EntityId;
		exerciseNotes?: JsonValue;
		properties?: Record<string, JsonValue>;
		sets: ReadonlyArray<{ occurredAt: string; properties: Record<string, JsonValue> }>;
	},
) =>
	Effect.gen(function* () {
		const submittedAt = DateTime.formatIso(yield* DateTime.now);
		const { schema: workoutSchema } = yield* findFitnessEntitySchema(client, "workout");
		const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
		const properties = {
			startedAt: input.startedAt,
			...(input.endedAt === undefined ? {} : { endedAt: input.endedAt }),
			...input.properties,
			...(input.exerciseNotes === undefined ? {} : { exerciseNotes: input.exerciseNotes }),
		};
		const first = input.sets[0];
		if (first === undefined) {
			const workout = yield* createEntity(client, {
				properties,
				name: input.name,
				entitySchema: workoutSchema.reference,
			});
			return { created: { count: 0 }, workoutId: workout.id };
		}
		const exercise = yield* getEntity(client, input.exerciseId);
		const normalized = yield* Schema.decodeUnknownEffect(WorkoutEditorSaveInputSchema)({
			submittedAt,
			submissionId: crypto.randomUUID(),
			data: {
				...workoutData({ name: input.name, endedAt: input.endedAt, startedAt: input.startedAt }),
				occurrences: [
					{
						...workoutOccurrence(input.exerciseId, []),
						sets: [
							{
								...workoutSet({ occurredAt: first.occurredAt }),
								...first.properties,
								measurements: first.properties,
								setLot: first.properties["setLot"] ?? "normal",
								confirmedAt: first.properties["confirmedAt"] ?? first.occurredAt,
								exerciseKind: first.properties["exerciseKind"] ?? exercise.properties["kind"],
							},
						],
					},
				],
			},
		});
		const saved = yield* saveWorkoutData(client, normalized.data, normalized.submissionId);
		assertCondition(saved.kind === "saved", "Expected the anchored fixture workout to save");
		const workout = yield* getEntity(client, saved.entityId);
		const edited = yield* client.call((c) =>
			c.entities.saveEditor({
				payload: {
					submittedAt,
					idempotencyKey: crypto.randomUUID(),
					submission: {
						action: "save",
						name: input.name,
						relationships: [],
						entitySchema: workoutSchema.reference,
						properties: { ...workout.properties, ...properties },
						target: {
							kind: "update",
							entityId: workout.id,
							expected: {
								relationships: [],
								name: workout.name,
								updatedAt: workout.updatedAt,
								properties: workout.properties,
							},
						},
					},
				},
			}),
		);
		assertCondition(edited.output.kind === "saved", "Expected fixture workout properties to save");
		const response = yield* client.call((c) =>
			c.events.create({
				payload: input.sets
					.slice(1)
					.map((set, index) => ({
						entityId: input.exerciseId,
						occurredAt: set.occurredAt,
						sessionEntityId: workout.id,
						eventSchemaSlug: workoutSetEventSchema.id,
						properties: { exerciseOrder: 0, setOrder: index + 1, ...set.properties },
					})),
			}),
		);
		const created = yield* waitForCreateEvents(client, response, input.timeoutMs);
		return { workoutId: workout.id, created: { count: created.count + 1 } };
	});
