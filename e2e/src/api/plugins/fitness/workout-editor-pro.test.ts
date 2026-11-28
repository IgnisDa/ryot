import type { EntityId } from "@ryot-app/contract/schema/brands";
import { workoutEditorLinksRecipe } from "@ryot-app/fitness-plugin/workout-editor-recipes";
import { objectContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { DateTime, Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	editTarget,
	fitnessRecipes,
	keepSet,
	loadWorkoutBaseline,
	operationInput,
	saveWorkoutEditor,
	templateData,
	type WorkoutData,
	workoutData,
	workoutEditorTimes,
	workoutOccurrence,
	workoutReference,
	workoutSet,
} from "~/fixtures/plugins/fitness";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const { setOccurredAt: occurredAt } = workoutEditorTimes;

describe("Workout editor with a valid Pro key", () => {
	it.live(
		"creates and edits templates with partial rows, zero rest, and exercise-only entries",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				expect((yield* client.call((contract) => contract.system.config())).entitlements).toEqual([
					"pro",
				]);
				const { exerciseId: weightedExerciseId } = yield* createExerciseEntityFixture(client);
				const { exerciseId: exerciseOnlyId } = yield* createExerciseEntityFixture(client);
				const name = `Partial Pro Template ${yield* randomUuid}`;
				const template = templateData({
					name,
					occurrences: [
						{
							images: [],
							videos: [],
							notes: ["Keep controlled"],
							exerciseId: weightedExerciseId,
							clientId: `occurrence-${yield* randomUuid}`,
							sets: [
								{
									restTime: 0,
									setLot: "normal",
									measurements: { reps: 0 },
									clientId: `set-${yield* randomUuid}`,
								},
								{
									restTime: 0,
									setLot: "warm_up",
									measurements: { weight: 0 },
									clientId: `set-${yield* randomUuid}`,
								},
							],
						},
						{
							sets: [],
							notes: [],
							images: [],
							videos: [],
							exerciseId: exerciseOnlyId,
							clientId: `occurrence-${yield* randomUuid}`,
						},
					],
				});
				const createInput = operationInput(template);
				const created = yield* saveWorkoutEditor(client, createInput);
				expect((yield* saveWorkoutEditor(client, createInput)).committed).toEqual(
					created.committed,
				);
				const baseline = yield* loadWorkoutBaseline(client, created.entityId, "workout-template");
				expect(baseline.baseline.entity.properties["exercises"]).toMatchObject([
					{
						exerciseId: weightedExerciseId,
						sets: [
							{ reps: 0, restTime: 0, setOrder: 0 },
							{ weight: 0, restTime: 0, setOrder: 1 },
						],
					},
					{ sets: [], exerciseId: exerciseOnlyId },
				]);

				const editInput = operationInput(
					templateData({
						name: `${name} edited`,
						target: editTarget(baseline),
						occurrences: [
							{
								images: [],
								videos: [],
								sourceExerciseOrder: 0,
								notes: ["Keep controlled"],
								exerciseId: weightedExerciseId,
								clientId: `occurrence-${yield* randomUuid}`,
								sets: [
									{
										restTime: 0,
										setLot: "normal",
										measurements: { reps: 5 },
										clientId: `set-${yield* randomUuid}`,
									},
									{
										restTime: 0,
										setLot: "warm_up",
										measurements: { weight: 0 },
										clientId: `set-${yield* randomUuid}`,
									},
								],
							},
							{
								sets: [],
								notes: [],
								images: [],
								videos: [],
								sourceExerciseOrder: 1,
								exerciseId: exerciseOnlyId,
								clientId: `occurrence-${yield* randomUuid}`,
							},
						],
					}),
				);
				const edited = yield* saveWorkoutEditor(client, editInput);
				expect((yield* saveWorkoutEditor(client, editInput)).committed).toEqual(edited.committed);
				const stale = yield* Effect.flip(
					saveWorkoutEditor(client, {
						...editInput,
						submissionId: yield* randomUuid,
						submittedAt: DateTime.formatIso(yield* DateTime.now),
					}),
				);
				assertTaggedError(stale, "PluginConflictError");
				expect(stale.reason).toMatchObject({ code: "changes-conflict" });

				const current = yield* loadWorkoutBaseline(client, created.entityId, "workout-template");
				expect(current.baseline.entity.name).toBe(`${name} edited`);
				expect(current.baseline.entity.properties["exercises"]).toMatchObject([
					{
						exerciseId: weightedExerciseId,
						sets: [
							{ reps: 5, restTime: 0 },
							{ weight: 0, restTime: 0 },
						],
					},
					{ sets: [], exerciseId: exerciseOnlyId },
				]);
			}),
	);

	it.live("creates repeat and template source links", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const sourceWorkout = yield* saveWorkoutEditor(
				client,
				operationInput(workoutData({ occurrences: [], name: "Workout source" })),
			);
			const sourceTemplate = yield* saveWorkoutEditor(
				client,
				operationInput(
					templateData({
						occurrences: [
							{
								sets: [],
								notes: [],
								exerciseId,
								images: [],
								videos: [],
								clientId: "template-occurrence",
							},
						],
					}),
				),
			);

			const repeated = yield* saveWorkoutEditor(
				client,
				operationInput(
					workoutData({
						occurrences: [workoutOccurrence(exerciseId, [])],
						target: { kind: "create", repeatedFromId: sourceWorkout.entityId },
					}),
				),
			);
			const fromTemplate = yield* saveWorkoutEditor(
				client,
				operationInput(
					workoutData({
						occurrences: [workoutOccurrence(exerciseId, [])],
						target: { kind: "create", templateId: sourceTemplate.entityId },
					}),
				),
			);

			const reference = yield* workoutReference(client);
			const repeatedLinks = yield* fitnessRecipes.execute(
				client,
				workoutEditorLinksRecipe({ reference }),
				{ workoutId: repeated.entityId },
			);
			expect(repeatedLinks.items).toContainEqual<unknown>(
				objectContaining({ slug: "workout-repeated-from", targetEntityId: sourceWorkout.entityId }),
			);
			const templateLinks = yield* fitnessRecipes.execute(
				client,
				workoutEditorLinksRecipe({ reference }),
				{ workoutId: fromTemplate.entityId },
			);
			expect(templateLinks.items).toContainEqual<unknown>(
				objectContaining({
					slug: "workout-to-workout-template",
					targetEntityId: sourceTemplate.entityId,
				}),
			);
		}),
	);

	it.live("replaces a set between compatible exercises and rejects incompatible kinds", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId: originalExerciseId } = yield* createExerciseEntityFixture(client);
			const { exerciseId: replacementExerciseId } = yield* createExerciseEntityFixture(client);
			const { exerciseId: incompatibleExerciseId } = yield* createExerciseEntityFixture(client, {
				kind: "duration",
			});
			const created = yield* saveWorkoutEditor(
				client,
				operationInput(
					workoutData({
						occurrences: [
							workoutOccurrence(originalExerciseId, [workoutSet()], {
								images: [{ type: "remote", url: "https://example.com/replacement.jpg" }],
								videos: [{ type: "remote", url: "https://example.com/replacement.mp4" }],
							}),
						],
					}),
				),
			);
			const baseline = yield* loadWorkoutBaseline(client, created.entityId);
			const originalSet = requirePresent(
				baseline.baseline.sets[0],
				"Expected the confirmed source set",
			);
			const replacementData = (
				exerciseId: EntityId,
				loaded: Parameters<typeof editTarget>[0],
				kept: Parameters<typeof keepSet>[0],
			): WorkoutData =>
				workoutData({
					target: editTarget(loaded),
					name: baseline.baseline.entity.name,
					occurrences: [
						workoutOccurrence(exerciseId, [keepSet(kept)], {
							sourceExerciseOrder: 0,
							images: [{ type: "remote", url: "https://example.com/replacement.jpg" }],
							videos: [{ type: "remote", url: "https://example.com/replacement.mp4" }],
						}),
					],
				});

			const replaced = yield* saveWorkoutEditor(
				client,
				operationInput(replacementData(replacementExerciseId, baseline, originalSet)),
			);
			const replacementSet = requirePresent(replaced.sets[0], "Expected the recreated set");
			expect(replaced.sets).toHaveLength(1);
			expect(replacementSet.eventId).not.toBe(originalSet.id);
			const replacedBaseline = yield* loadWorkoutBaseline(client, created.entityId);
			const replacedSet = requirePresent(
				replacedBaseline.baseline.sets[0],
				"Expected the set after compatible replacement",
			);
			expect(replacedSet).toMatchObject({
				id: replacementSet.eventId,
				entityId: replacementExerciseId,
				occurredAt: originalSet.occurredAt,
			});
			expect(replacedSet.properties).toMatchObject({ confirmedAt: occurredAt });
			expect(replacedBaseline.baseline.entity.properties["exerciseMedia"]).toMatchObject([
				{
					exerciseOrder: 0,
					images: [{ type: "remote", url: "https://example.com/replacement.jpg" }],
					videos: [{ type: "remote", url: "https://example.com/replacement.mp4" }],
				},
			]);

			const incompatible = yield* Effect.flip(
				saveWorkoutEditor(
					client,
					operationInput(replacementData(incompatibleExerciseId, replacedBaseline, replacedSet)),
				),
			);
			assertTaggedError(incompatible, "PluginOperationRejected");
			expect(incompatible.reason).toMatchObject({
				key: "rejection.workout-save.invalid-exercise-kind",
			});
			const unchanged = yield* loadWorkoutBaseline(client, created.entityId);
			expect(unchanged.baseline.sets[0]?.entityId).toBe(replacementExerciseId);
		}),
	);

	it.live("saves Pro set notes but rejects unowned managed media", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const noted = yield* saveWorkoutEditor(
				client,
				operationInput(
					workoutData({
						occurrences: [
							workoutOccurrence(exerciseId, [workoutSet({ note: "Pro training note" })]),
						],
					}),
				),
			);
			const notedBaseline = yield* loadWorkoutBaseline(client, noted.entityId);
			expect(notedBaseline.baseline.sets[0]?.properties).toMatchObject({
				note: "Pro training note",
			});

			const unownedImage: WorkoutData["images"] = [
				{ type: "s3", key: `workouts/unowned-${yield* randomUuid}.jpg` },
			];
			const unownedVideo: WorkoutData["occurrences"][number]["videos"] = [
				{ type: "local", key: `permanent/unowned-${yield* randomUuid}.mp4` },
			];
			const refused = yield* Effect.flip(
				saveWorkoutEditor(
					client,
					operationInput(
						workoutData({
							images: unownedImage,
							occurrences: [
								workoutOccurrence(exerciseId, [workoutSet()], { videos: unownedVideo }),
							],
						}),
					),
				),
			);
			assertTaggedError(refused, "PluginOperationRejected");
			expect(refused.reason).toMatchObject({ key: "rejection.workout-save.media-forbidden" });
		}),
	);
});
