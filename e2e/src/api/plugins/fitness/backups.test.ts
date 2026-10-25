import { EventSchemaSlug, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { anyOf, objectContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import {
	exportAndDownloadBackup,
	readBackupSection,
	restoreBackup,
} from "~/fixtures/kernel/backups";
import { createEntity, findEntityIdByName, getEntity } from "~/fixtures/kernel/entities";
import { listEventsForEntity } from "~/fixtures/kernel/events";
import { createRelationship, findRelationshipBySchema } from "~/fixtures/kernel/relationships";
import { deleteUserAndWait } from "~/fixtures/kernel/user-lifecycle";
import {
	createExerciseEntityFixture,
	findFitnessEntitySchema,
} from "~/fixtures/plugins/fitness/exercises";
import {
	saveWorkoutData,
	workoutData,
	workoutOccurrence,
	workoutSet,
} from "~/fixtures/plugins/fitness/workout-editor";
import { assertCompleted, assertCondition } from "~/support/assertions";
import { expect, it } from "~/support/effect-test";

it.live("remaps Fitness occurrence targets and equipment without replacing frozen roles", () =>
	Effect.gen(function* () {
		const source = yield* createAuthenticatedClient();
		const target = yield* createAuthenticatedClient();
		const { exercise } = yield* createExerciseEntityFixture(source.client);
		const { schema: targetSchema } = yield* findFitnessEntitySchema(
			source.client,
			"exercise-target",
		);
		const { schema: equipmentSchema } = yield* findFitnessEntitySchema(
			source.client,
			"exercise-equipment",
		);
		const { schema: workoutSchema } = yield* findFitnessEntitySchema(source.client, "workout");
		const { schema: exerciseSchema } = yield* findFitnessEntitySchema(source.client, "exercise");
		const recordedTarget = yield* createEntity(source.client, {
			name: "Recorded target",
			properties: { kind: "muscle" },
			entitySchema: targetSchema.reference,
		});
		const recordedEquipment = yield* createEntity(source.client, {
			properties: {},
			name: "Recorded equipment",
			entitySchema: equipmentSchema.reference,
		});
		const owner = exerciseSchema.reference.owner;
		const targetRelationship = {
			sourceEntityId: exercise.id,
			targetEntityId: recordedTarget.id,
			relationshipSchema: { owner, slug: RelationshipSchemaSlug.make("exercise-targets") },
		};
		yield* createRelationship(source.client, {
			...targetRelationship,
			properties: { role: "primary" },
		});
		yield* createRelationship(source.client, {
			properties: {},
			sourceEntityId: exercise.id,
			targetEntityId: recordedEquipment.id,
			relationshipSchema: { owner, slug: RelationshipSchemaSlug.make("exercise-uses-equipment") },
		});
		const eventSchemaSlug = EventSchemaSlug.make("workout-exercise");
		const workoutStartedAt = "2026-04-27T10:00:00.000Z";
		const workoutSetOccurredAt = "2026-04-27T10:15:00.000Z";
		const saved = yield* saveWorkoutData(
			source.client,
			workoutData({
				startedAt: workoutStartedAt,
				name: `Recorded workout ${yield* randomUuid}`,
				occurrences: [
					workoutOccurrence(exercise.id, [
						workoutSet({
							occurredAt: workoutSetOccurredAt,
							confirmedAt: workoutSetOccurredAt,
							measurements: { reps: 8, weight: 10 },
						}),
					]),
				],
			}),
		);
		assertCondition(saved.kind === "saved", "Expected the Fitness workout to save");
		const workoutId = saved.entityId;
		const facts = {
			exerciseOrder: 0,
			provenance: "recorded",
			exerciseKind: "reps_and_weight",
			equipment: [recordedEquipment.id],
			targets: [{ role: "primary", entityId: recordedTarget.id }],
		};
		const sourceEvents = yield* listEventsForEntity(source.client, exercise.id, undefined, 100);
		const sourceOccurrenceEvents = sourceEvents.filter(
			({ eventSchemaSlug: slug }) => slug === eventSchemaSlug,
		);
		expect(sourceOccurrenceEvents).toHaveLength(1);
		expect(sourceOccurrenceEvents[0]).toMatchObject({
			properties: facts,
			sessionEntityId: workoutId,
			occurredAt: workoutStartedAt,
		});
		yield* createRelationship(source.client, {
			...targetRelationship,
			properties: { role: "secondary" },
		});
		const { bytes } = yield* exportAndDownloadBackup(source.client);
		const archivedOccurrenceEvents = (yield* readBackupSection(bytes, "events.ndjson")).filter(
			({ eventSchemaSlug: slug }) => slug === eventSchemaSlug,
		);
		expect(archivedOccurrenceEvents.map(({ properties }) => properties)).toEqual([facts]);
		const workout = yield* getEntity(source.client, workoutId);
		yield* deleteUserAndWait(source.userId);
		assertCompleted((yield* restoreBackup(target.client, bytes)).run, "Fitness occurrence restore");
		const restoredExerciseId = yield* findEntityIdByName(target.client, {
			name: exercise.name,
			entitySchema: exerciseSchema.reference,
		});
		const restoredWorkoutId = yield* findEntityIdByName(target.client, {
			name: workout.name,
			entitySchema: workoutSchema.reference,
		});
		const restoredTargetId = yield* findEntityIdByName(target.client, {
			name: recordedTarget.name,
			entitySchema: targetSchema.reference,
		});
		const restoredEquipmentId = yield* findEntityIdByName(target.client, {
			name: recordedEquipment.name,
			entitySchema: equipmentSchema.reference,
		});
		expect(restoredExerciseId).not.toBe(exercise.id);
		expect(restoredWorkoutId).not.toBe(workoutId);
		expect(restoredTargetId).not.toBe(recordedTarget.id);
		expect(restoredEquipmentId).not.toBe(recordedEquipment.id);
		const restoredEvents = yield* listEventsForEntity(
			target.client,
			restoredExerciseId,
			undefined,
			100,
		);
		const restoredOccurrenceEvents = restoredEvents.filter(
			({ eventSchemaSlug: slug }) => slug === eventSchemaSlug,
		);
		expect(restoredOccurrenceEvents).toEqual([
			{
				eventSchemaSlug,
				id: anyOf(String),
				occurredAt: workoutStartedAt,
				sessionEntityId: restoredWorkoutId,
				properties: {
					...facts,
					equipment: [restoredEquipmentId],
					targets: [{ role: "primary", entityId: restoredTargetId }],
				},
			},
		]);
		const restoredSetEvents = restoredEvents.filter(
			({ eventSchemaSlug: slug }) => slug === "workout-set",
		);
		expect(restoredSetEvents).toContainEqual(
			objectContaining({ sessionEntityId: restoredWorkoutId }),
		);
		expect(
			(yield* findRelationshipBySchema(target.client, {
				owner,
				targetEntityId: restoredTargetId,
				sourceEntityId: restoredExerciseId,
				relationshipSchemaSlug: "exercise-targets",
			})).properties,
		).toEqual({ role: "secondary" });
	}),
);
