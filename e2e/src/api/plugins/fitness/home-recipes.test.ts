import type { EntityId } from "@ryot-app/contract/schema/brands";
import { muscleActivityRecipe } from "@ryot-app/fitness-plugin/home-recipes";
import { randomUuid } from "@ryot-app/testing/random";
import { DateTime, Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	executeRyotQLRecipe,
	insertGlobalRelationship,
	insertRelationshipRow,
	seedEntity,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	createExerciseEntityFixture,
	findFitnessEntitySchema,
	findFitnessRelationshipSchema,
	saveWorkoutData,
	workoutData,
	workoutOccurrence,
	workoutSet,
} from "~/fixtures/plugins/fitness";
import { assertCondition } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Home muscle activity recipe", () => {
	it.live(
		"keeps target identities, effective role weights, all-role recency and empty targets",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const other = yield* createAuthenticatedClient();
				const { pluginId, schema: targetSchema } = yield* findFitnessEntitySchema(
					client,
					"exercise-target",
				);
				const { schema: exerciseSchema } = yield* findFitnessEntitySchema(client, "exercise");
				const targetLink = yield* findFitnessRelationshipSchema(client, "exercise-targets");
				const suffix = yield* randomUuid;
				const name = `Activity target ${suffix}`;
				const shared = yield* seedEntity({
					name,
					providerId: null,
					entitySchema: targetSchema.reference,
					properties: { kind: "muscle_region" },
					externalId: `activity-target-${suffix}`,
				});
				const privateTarget = (targetName: string) =>
					createEntity(client, {
						name: targetName,
						entitySchema: targetSchema.reference,
						properties: { kind: "muscle_region" },
					});
				const personal = yield* privateTarget(name);
				const stabilizerOnly = yield* privateTarget(`Activity stabilizer ${suffix}`);
				const idle = yield* privateTarget(`Activity idle ${suffix}`);
				const unlinked = yield* privateTarget(`Activity unlinked ${suffix}`);
				const foreign = yield* createEntity(other.client, {
					name: `Activity foreign ${suffix}`,
					entitySchema: targetSchema.reference,
					properties: { kind: "muscle_region" },
				});
				const primary = yield* seedEntity({
					providerId: null,
					name: `Activity exercise ${suffix}`,
					entitySchema: exerciseSchema.reference,
					properties: { kind: "reps_and_weight" },
					externalId: `activity-exercise-${suffix}`,
				});
				const secondary = yield* createExerciseEntityFixture(client);
				const untyped = yield* createExerciseEntityFixture(client);
				const stabilizer = yield* createExerciseEntityFixture(client);
				const idleExercise = yield* createExerciseEntityFixture(client);
				const link = (exerciseId: string, targetId: string, role?: string) =>
					insertRelationshipRow(client, {
						targetEntityId: targetId,
						sourceEntityId: exerciseId,
						relationshipSchema: targetLink.reference,
						properties: role === undefined ? {} : { role },
					});
				yield* link(primary.id, shared.id, "secondary");
				yield* insertGlobalRelationship({
					targetEntityId: shared.id,
					sourceEntityId: primary.id,
					properties: { role: "primary" },
					relationshipSchema: targetLink.reference,
				});
				yield* link(secondary.exerciseId, shared.id, "secondary");
				yield* link(untyped.exerciseId, personal.id);
				yield* link(stabilizer.exerciseId, shared.id, "stabilizer");
				yield* link(stabilizer.exerciseId, stabilizerOnly.id, "stabilizer");
				yield* link(idleExercise.exerciseId, idle.id, "primary");
				const weekStartAt = "2026-10-14T00:00:00.000Z";
				const oldAt = "2026-10-13T23:59:59.999Z";
				const secondaryAt = "2026-10-15T09:00:00.000Z";
				const stabilizerAt = "2026-10-20T09:00:00.000Z";
				const log = (recordingClient: Client, exerciseId: EntityId, occurredAt: string) =>
					Effect.gen(function* () {
						const saved = yield* saveWorkoutData(
							recordingClient,
							workoutData({
								startedAt: occurredAt,
								name: `Activity workout ${suffix} ${yield* randomUuid}`,
								endedAt: DateTime.formatIso(
									DateTime.add(DateTime.makeUnsafe(occurredAt), { hours: 1 }),
								),
								occurrences: [
									workoutOccurrence(exerciseId, [
										workoutSet({
											occurredAt,
											confirmedAt: occurredAt,
											measurements: { reps: 5, weight: 10 },
										}),
									]),
								],
							}),
						);
						assertCondition(saved.kind === "saved", "Expected the activity workout to save");
					});
				yield* log(client, primary.id, oldAt);
				yield* log(client, primary.id, weekStartAt);
				yield* log(client, secondary.exerciseId, secondaryAt);
				yield* log(client, untyped.exerciseId, weekStartAt);
				yield* log(client, stabilizer.exerciseId, stabilizerAt);
				yield* log(other.client, primary.id, "2026-10-21T09:00:00.000Z");
				const recipe = muscleActivityRecipe({
					weekStartAt,
					reference: { pluginId, kind: "local" },
				});
				const activity = yield* executeRyotQLRecipe(client, recipe);
				const ids = new Set<string>([
					idle.id,
					shared.id,
					foreign.id,
					personal.id,
					unlinked.id,
					stabilizerOnly.id,
				]);
				expect(activity.filter(({ id }) => ids.has(id))).toEqual([
					{ id: idle.id, weeklySets: 0, name: idle.name, lastTrainedAt: null },
					{ weeklySets: 0, id: unlinked.id, name: unlinked.name, lastTrainedAt: null },
					{ name, weeklySets: 1, id: personal.id, lastTrainedAt: weekStartAt },
					{
						weeklySets: 0,
						id: stabilizerOnly.id,
						name: stabilizerOnly.name,
						lastTrainedAt: stabilizerAt,
					},
					{ name, id: shared.id, weeklySets: 1.5, lastTrainedAt: stabilizerAt },
				]);
				const later = yield* executeRyotQLRecipe(
					client,
					muscleActivityRecipe({
						reference: { pluginId, kind: "local" },
						weekStartAt: "2026-10-22T00:00:00.000Z",
					}),
				);
				expect(later.filter(({ id }) => ids.has(id))).toEqual(
					activity
						.filter(({ id }) => ids.has(id))
						.map(({ id, lastTrainedAt, name: targetName }) => ({
							id,
							weeklySets: 0,
							lastTrainedAt,
							name: targetName,
						})),
				);
				const otherActivity = yield* executeRyotQLRecipe(other.client, recipe);
				expect(otherActivity.filter(({ id }) => ids.has(id))).toEqual([
					{ weeklySets: 0, id: foreign.id, name: foreign.name, lastTrainedAt: null },
					{ name, id: shared.id, weeklySets: 1, lastTrainedAt: "2026-10-21T09:00:00.000Z" },
				]);
			}),
	);
});
