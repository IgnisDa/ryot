import type { ContractPayload } from "@ryot-app/contract/client";
import { WorkoutExercisePropertiesSchema } from "@ryot-app/fitness-plugin/workout-taxonomy";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect, Schema } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { listEventsForEntity } from "~/fixtures/kernel/events";
import { createRelationship } from "~/fixtures/kernel/relationships";
import { requirePresent } from "~/support/assertions";

import { findFitnessEntitySchema } from "./exercises";
import { findFitnessRelationshipSchema } from "./workout-templates";

type RecordedTargetRole = Schema.Schema.Type<
	typeof WorkoutExercisePropertiesSchema
>["targets"][number]["role"];

export const findWorkoutExerciseEventSchema = (client: Client) =>
	Effect.gen(function* () {
		const { schema } = yield* findFitnessEntitySchema(client, "exercise");
		return requireEventSchemaBySlug(
			yield* listEventSchemas(client, schema.reference),
			"workout-exercise",
		);
	});

export const createWorkoutOccurrenceTaxonomy = (
	client: Client,
	exerciseId: ContractPayload<"relationships", "create">["sourceEntityId"],
	input: { readonly equipmentCount: number; readonly targetRoles: readonly RecordedTargetRole[] },
) =>
	Effect.gen(function* () {
		const [targetSchema, equipmentSchema, targetRelationship, equipmentRelationship] =
			yield* Effect.all([
				findFitnessEntitySchema(client, "exercise-target"),
				findFitnessEntitySchema(client, "exercise-equipment"),
				findFitnessRelationshipSchema(client, "exercise-targets"),
				findFitnessRelationshipSchema(client, "exercise-uses-equipment"),
			]);
		const targets = yield* Effect.forEach(input.targetRoles, (role) =>
			Effect.gen(function* () {
				const entity = yield* createEntity(client, {
					properties: { kind: "muscle_region" },
					entitySchema: targetSchema.schema.reference,
					name: `Workout occurrence target ${yield* randomUuid}`,
				});
				yield* createRelationship(client, {
					targetEntityId: entity.id,
					sourceEntityId: exerciseId,
					properties: role === null ? {} : { role },
					relationshipSchema: targetRelationship.reference,
				});
				return { role, entity };
			}),
		);
		const equipment = yield* Effect.forEach(Array.from({ length: input.equipmentCount }), () =>
			Effect.gen(function* () {
				const entity = yield* createEntity(client, {
					properties: {},
					entitySchema: equipmentSchema.schema.reference,
					name: `Workout occurrence equipment ${yield* randomUuid}`,
				});
				yield* createRelationship(client, {
					targetEntityId: entity.id,
					sourceEntityId: exerciseId,
					relationshipSchema: equipmentRelationship.reference,
				});
				return entity;
			}),
		);

		return {
			equipment: equipment.map(({ id }) => id),
			targets: targets.map(({ role, entity }) => ({ role, entityId: entity.id })),
		};
	});

export const readWorkoutOccurrences = (client: Client, exerciseId: string, workoutId: string) =>
	Effect.gen(function* () {
		const events = yield* listEventsForEntity(client, exerciseId, undefined, 100, {
			eventSchemaSlug: "workout-exercise",
		});
		const occurrences = events.filter(({ sessionEntityId }) => sessionEntityId === workoutId);
		return yield* Effect.forEach(occurrences, (event) =>
			Effect.gen(function* () {
				const sessionEntityId = requirePresent(
					event.sessionEntityId,
					"Expected the workout occurrence to reference its workout",
				);
				const properties = yield* Schema.decodeUnknownEffect(WorkoutExercisePropertiesSchema)(
					event.properties,
				);
				return { ...event, properties, sessionEntityId };
			}),
		);
	});
