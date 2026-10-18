import type { EntityId } from "@ryot-app/contract/schema/brands";
import { workoutEditorLinksRecipe } from "@ryot-app/fitness-plugin/workout-editor-recipes";
import { DateTime, Effect, Exit, Scope } from "effect";

import { createAuthenticatedClient, executeRyotQLRecipe } from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	editTarget,
	keepSet,
	loadWorkoutBaseline,
	operationInput,
	saveWorkoutEditor,
	templateData,
	type WorkoutData,
	workoutData,
	workoutEditorProServer,
	workoutEditorTimes,
	workoutOccurrence,
	workoutReference,
	workoutSet,
} from "~/fixtures/plugins/fitness";
import { assertCondition, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";

const { setOccurredAt: occurredAt } = workoutEditorTimes;

const scope = Scope.makeUnsafe();
let apiUrl: string;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			const server = yield* workoutEditorProServer;
			apiUrl = server.apiUrl;
		}).pipe(
			Effect.provideService(Scope.Scope, scope),
			Effect.onError(() => Scope.close(scope, Exit.void)),
		),
	),
);

afterAll(() => runPromise(Scope.close(scope, Exit.void)));

describe("Workout editor with a valid Pro key", () => {
	it.live(
		"creates and edits templates with partial rows, zero rest, and exercise-only entries",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient(apiUrl);
				expect(
					(yield* client.call((contract) => contract.system.config())).pro.isServerKeyValidated,
				).toBe(true);
				const { exerciseId: weightedExerciseId } = yield* createExerciseEntityFixture(client);
				const { exerciseId: exerciseOnlyId } = yield* createExerciseEntityFixture(client);
				const name = `Partial Pro Template ${crypto.randomUUID()}`;
				const template = templateData({
					name,
					occurrences: [
						{
							images: [],
							videos: [],
							notes: ["Keep controlled"],
							exerciseId: weightedExerciseId,
							clientId: `occurrence-${crypto.randomUUID()}`,
							sets: [
								{
									restTime: 0,
									setLot: "normal",
									measurements: { reps: 0 },
									clientId: `set-${crypto.randomUUID()}`,
								},
								{
									restTime: 0,
									setLot: "warm_up",
									measurements: { weight: 0 },
									clientId: `set-${crypto.randomUUID()}`,
								},
							],
						},
						{
							sets: [],
							notes: [],
							images: [],
							videos: [],
							exerciseId: exerciseOnlyId,
							clientId: `occurrence-${crypto.randomUUID()}`,
						},
					],
				});
				const createInput = operationInput(template);
				const created = yield* saveWorkoutEditor(client, createInput);
				assertCondition(created.kind === "saved", "Expected the Pro template to save");
				expect(yield* saveWorkoutEditor(client, createInput)).toEqual(created);
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
								clientId: `occurrence-${crypto.randomUUID()}`,
								sets: [
									{
										restTime: 0,
										setLot: "normal",
										measurements: { reps: 5 },
										clientId: `set-${crypto.randomUUID()}`,
									},
									{
										restTime: 0,
										setLot: "warm_up",
										measurements: { weight: 0 },
										clientId: `set-${crypto.randomUUID()}`,
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
								clientId: `occurrence-${crypto.randomUUID()}`,
							},
						],
					}),
				);
				const edited = yield* saveWorkoutEditor(client, editInput);
				assertCondition(edited.kind === "saved", "Expected the Pro template edit to save");
				expect(yield* saveWorkoutEditor(client, editInput)).toEqual(edited);
				expect(
					yield* saveWorkoutEditor(client, {
						...editInput,
						submissionId: crypto.randomUUID(),
						submittedAt: DateTime.formatIso(yield* DateTime.now),
					}),
				).toEqual({ kind: "conflict" });

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
			const { client } = yield* createAuthenticatedClient(apiUrl);
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const sourceWorkout = yield* saveWorkoutEditor(
				client,
				operationInput(workoutData({ occurrences: [], name: "Workout source" })),
			);
			assertCondition(sourceWorkout.kind === "saved", "Expected source workout save");
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
			assertCondition(sourceTemplate.kind === "saved", "Expected source template save");

			const repeated = yield* saveWorkoutEditor(
				client,
				operationInput(
					workoutData({
						occurrences: [workoutOccurrence(exerciseId, [])],
						target: { kind: "create", repeatedFromId: sourceWorkout.entityId },
					}),
				),
			);
			assertCondition(repeated.kind === "saved", "Expected repeated workout save");
			const fromTemplate = yield* saveWorkoutEditor(
				client,
				operationInput(
					workoutData({
						occurrences: [workoutOccurrence(exerciseId, [])],
						target: { kind: "create", templateId: sourceTemplate.entityId },
					}),
				),
			);
			assertCondition(fromTemplate.kind === "saved", "Expected template-based workout save");

			const reference = yield* workoutReference(client);
			const repeatedLinks = yield* executeRyotQLRecipe(
				client,
				workoutEditorLinksRecipe({ reference, workoutId: repeated.entityId }),
			);
			expect(repeatedLinks.items).toContainEqual(
				expect.objectContaining({
					slug: "workout-repeated-from",
					targetEntityId: sourceWorkout.entityId,
				}),
			);
			const templateLinks = yield* executeRyotQLRecipe(
				client,
				workoutEditorLinksRecipe({ reference, workoutId: fromTemplate.entityId }),
			);
			expect(templateLinks.items).toContainEqual(
				expect.objectContaining({
					slug: "workout-to-workout-template",
					targetEntityId: sourceTemplate.entityId,
				}),
			);
		}),
	);

	it.live("replaces a set between compatible exercises and rejects incompatible kinds", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(apiUrl);
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
			assertCondition(created.kind === "saved", "Expected the source workout save");
			const baseline = yield* loadWorkoutBaseline(client, created.entityId);
			const originalSet = requirePresent(
				baseline.baseline.sets[0],
				"Expected the confirmed source set",
			);
			const replacementData = (
				exerciseId: EntityId,
				loaded: Parameters<typeof editTarget>[0],
			): WorkoutData =>
				workoutData({
					target: editTarget(loaded),
					name: baseline.baseline.entity.name,
					occurrences: [
						workoutOccurrence(exerciseId, [keepSet(originalSet)], {
							sourceExerciseOrder: 0,
							images: [{ type: "remote", url: "https://example.com/replacement.jpg" }],
							videos: [{ type: "remote", url: "https://example.com/replacement.mp4" }],
						}),
					],
				});

			const replaced = yield* saveWorkoutEditor(
				client,
				operationInput(replacementData(replacementExerciseId, baseline)),
			);
			assertCondition(replaced.kind === "saved", "Expected compatible Pro replacement to save");
			expect(replaced.sets.map(({ eventId }) => eventId)).toEqual([originalSet.id]);
			const replacedBaseline = yield* loadWorkoutBaseline(client, created.entityId);
			const replacedSet = requirePresent(
				replacedBaseline.baseline.sets[0],
				"Expected the set after compatible replacement",
			);
			expect(replacedSet).toMatchObject({
				id: originalSet.id,
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

			const incompatible = yield* saveWorkoutEditor(
				client,
				operationInput(replacementData(incompatibleExerciseId, replacedBaseline)),
			);
			expect(incompatible).toEqual({ kind: "invalid", code: "invalid-exercise-kind" });
			const unchanged = yield* loadWorkoutBaseline(client, created.entityId);
			expect(unchanged.baseline.sets[0]?.entityId).toBe(replacementExerciseId);
		}),
	);

	it.live("saves Pro set notes but rejects unowned managed media", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(apiUrl);
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
			assertCondition(noted.kind === "saved", "Expected Pro set note save");
			const notedBaseline = yield* loadWorkoutBaseline(client, noted.entityId);
			expect(notedBaseline.baseline.sets[0]?.properties).toMatchObject({
				note: "Pro training note",
			});

			const unownedImage: WorkoutData["images"] = [
				{ type: "s3", key: `workouts/unowned-${crypto.randomUUID()}.jpg` },
			];
			const unownedVideo: WorkoutData["occurrences"][number]["videos"] = [
				{ type: "local", key: `permanent/unowned-${crypto.randomUUID()}.mp4` },
			];
			const refused = yield* saveWorkoutEditor(
				client,
				operationInput(
					workoutData({
						images: unownedImage,
						occurrences: [workoutOccurrence(exerciseId, [workoutSet()], { videos: unownedVideo })],
					}),
				),
			);
			expect(refused).toEqual({ kind: "invalid", code: "media-forbidden" });
		}),
	);
});
