import { EntityId, EventId, SignalSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { entitlementRequired } from "@ryot-app/contract/schema/entitlement";
import {
	type WorkoutEditorBaseline,
	workoutEditorEntityRecipe,
	workoutEditorMembershipRecipe,
	workoutEditorSetsRecipe,
} from "@ryot-app/fitness-plugin/workout-editor-recipes";
import { workoutCardsRecipe } from "@ryot-app/fitness-plugin/workout-list-recipes";
import { anyOf, arrayContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { DateTime, Effect, Struct } from "effect";

import {
	createAuthenticatedClient,
	listEventsForEntity,
	listSignalTriggers,
	pollSignalTrigger,
	uploadPermanentAsset,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	correctWorkoutTimes,
	createExerciseEntityFixture,
	editTarget,
	findFitnessEntitySchema,
	fitnessRecipes,
	keepSet,
	LARGE_WORKOUT_BUDGET,
	loadWorkoutBaseline,
	loadWorkoutEditorContext,
	operationInput,
	saveWorkoutData,
	saveWorkoutEditor,
	seedExerciseWorkout,
	templateData,
	updateExerciseOverrides,
	type WorkoutData,
	workoutData,
	workoutEditorTimes,
	workoutOccurrence,
	type WorkoutOccurrenceInput,
	workoutReference,
	workoutSet,
} from "~/fixtures/plugins/fitness";
import { readWorkoutOccurrences } from "~/fixtures/plugins/fitness/workout-occurrences";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { startIsolatedHarness } from "~/support/isolated-harness";

const { endedAt, startedAt, setOccurredAt } = workoutEditorTimes;

let harness: undefined | Effect.Success<ReturnType<typeof startIsolatedHarness>>;
let target: Effect.Success<ReturnType<typeof startIsolatedHarness>>["target"];

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			harness = yield* startIsolatedHarness("Workout editor keyless", { SERVER_PRO_KEY: "" });
			target = harness.target;
		}),
	),
);

afterAll(() => runPromise(harness?.stop ?? Effect.void));

const createImportedWorkout = (client: Client, exerciseId: EntityId) =>
	Effect.gen(function* () {
		const upload = (fileName: string, contentType: string) =>
			uploadPermanentAsset(client, { fileName, contentType });
		const media = {
			videos: [yield* upload("imported-workout.mp4", "video/mp4")],
			images: [yield* upload("imported-workout.jpg", "image/jpeg")],
			occurrenceVideos: [yield* upload("imported-exercise.mp4", "video/mp4")],
			occurrenceImages: [yield* upload("imported-exercise.jpg", "image/jpeg")],
		};
		const { workoutId } = yield* seedExerciseWorkout(client, {
			endedAt,
			startedAt,
			exerciseId,
			name: `Imported Workout ${yield* randomUuid}`,
			exerciseNotes: [{ exerciseOrder: 0, notes: ["Imported exercise note"] }],
			properties: {
				activeDuration: 2400,
				images: media.images,
				videos: media.videos,
				exerciseMedia: [
					{ exerciseOrder: 0, images: media.occurrenceImages, videos: media.occurrenceVideos },
				],
			},
			sets: [
				{
					occurredAt: setOccurredAt,
					properties: {
						reps: 10,
						weight: 40,
						restTime: 90,
						setLot: "normal",
						note: "Imported set note",
						exerciseKind: "reps_and_weight",
					},
				},
			],
		});
		return { media, workoutId };
	});

const updateImportedWorkoutData = (input: {
	readonly reps: number;
	readonly exerciseId: EntityId;
	readonly conflictToken: string;
	readonly note?: string | undefined;
	readonly images: WorkoutData["images"];
	readonly videos: WorkoutData["videos"];
	readonly baseline: WorkoutEditorBaseline;
	readonly occurrenceImages: WorkoutOccurrenceInput["images"];
	readonly occurrenceVideos: WorkoutOccurrenceInput["videos"];
}): WorkoutData => {
	const originalSet = requirePresent(input.baseline.sets[0], "Expected the imported workout set");
	return workoutData({
		endedAt,
		startedAt,
		images: input.images,
		videos: input.videos,
		target: editTarget(input),
		name: input.baseline.entity.name,
		activeDuration: { kind: "preserve" },
		occurrences: [
			workoutOccurrence(
				input.exerciseId,
				[
					Struct.omit(
						keepSet(originalSet, {
							restTime: 90,
							measurements: { weight: 40, reps: input.reps },
							...(input.note === undefined ? {} : { note: input.note }),
						}),
						["confirmedAt"],
					),
				],
				{
					sourceExerciseOrder: 0,
					images: input.occurrenceImages,
					videos: input.occurrenceVideos,
					notes: ["Imported exercise note"],
				},
			),
		],
	});
};

describe("Workout editor E2E", () => {
	it.live("retries a confirmed zero-value workout save without duplicate entities or events", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const name = `Workout Editor Retry ${yield* randomUuid}`;
			const submissionId = yield* randomUuid;
			const input = operationInput(
				workoutData({ name, occurrences: [workoutOccurrence(exerciseId, [workoutSet()])] }),
				submissionId,
			);

			const saved = yield* saveWorkoutEditor(client, input);
			const [retry, concurrent] = yield* Effect.all(
				[saveWorkoutEditor(client, input), saveWorkoutEditor(client, input)],
				{ concurrency: "unbounded" },
			);
			const savedSet = requirePresent(saved.sets[0], "Expected the saved set");
			expect(saved.committed.events).toContainEqual({
				eventId: EventId.make(savedSet.eventId),
				itemIdentity: `set:${savedSet.clientId}`,
			});
			expect(retry.committed).toEqual(saved.committed);
			expect(concurrent.committed).toEqual(saved.committed);

			const changed = { ...input, data: { ...input.data, name: `${name} changed` } };
			const rejected = yield* Effect.flip(saveWorkoutEditor(client, changed));
			assertTaggedError(rejected, "PluginRequestError");
			expect(rejected.reason).toMatchObject({
				code: "validation-failed",
				diagnostics: [{ code: "operation-idempotency-conflict" }],
			});

			const reference = yield* workoutReference(client);
			const workouts = yield* fitnessRecipes.execute(client, workoutCardsRecipe({ reference }), {
				search: name,
			});
			expect(workouts.items.filter(({ name: itemName }) => itemName === name)).toHaveLength(1);
			const baseline = yield* loadWorkoutBaseline(client, saved.entityId);
			expect(baseline.baseline.sets).toHaveLength(1);
			expect(baseline.baseline.sets[0]?.id).toBe(saved.sets[0]?.eventId);
			const completedEvents = yield* listEventsForEntity(client, saved.entityId, undefined, 100);
			expect(
				completedEvents.filter(({ eventSchemaSlug }) => eventSchemaSlug === "workout-completed"),
			).toHaveLength(1);
		}),
	);

	it.live("emits one workout.created signal for a new workout and none for its edit", () =>
		Effect.gen(function* () {
			const { client, userId: rawUserId } = yield* createAuthenticatedClient();
			const userId = UserId.make(rawUserId);
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const { schema } = yield* findFitnessEntitySchema(client, "workout");
			const filter = {
				actorUserId: userId,
				signalSchema: {
					owner: schema.reference.owner,
					slug: SignalSchemaSlug.make("workout.created"),
				},
			};
			const created = yield* saveWorkoutData(
				client,
				workoutData({ occurrences: [workoutOccurrence(exerciseId, [workoutSet()])] }),
			);

			const signal = yield* pollSignalTrigger(filter);
			expect(signal.payload.properties["workoutId"]).toBe(created.entityId);
			expect(yield* listSignalTriggers(filter)).toHaveLength(1);

			const baseline = yield* loadWorkoutBaseline(client, created.entityId);
			const originalSet = requirePresent(baseline.baseline.sets[0], "Expected the created set");
			const editedName = `${baseline.baseline.entity.name} edited`;
			yield* saveWorkoutData(
				client,
				workoutData({
					name: editedName,
					target: editTarget(baseline),
					occurrences: [
						workoutOccurrence(
							exerciseId,
							[keepSet(originalSet, { measurements: { reps: 5, weight: 20 } })],
							{ sourceExerciseOrder: 0 },
						),
					],
				}),
			);
			expect((yield* loadWorkoutBaseline(client, created.entityId)).baseline.entity.name).toBe(
				editedName,
			);

			expect(yield* listSignalTriggers(filter)).toHaveLength(1);
		}),
	);

	it.live(
		"edits through a full baseline, replays the immutable edit, and rejects stale edits",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient(target);
				const { exerciseId } = yield* createExerciseEntityFixture(client);
				const { media, workoutId } = yield* createImportedWorkout(client, exerciseId);
				const original = yield* loadWorkoutBaseline(client, workoutId);
				const originalSet = requirePresent(original.baseline.sets[0], "Expected imported set");
				const editData = updateImportedWorkoutData({
					...media,
					reps: 12,
					exerciseId,
					note: "Imported set note",
					baseline: original.baseline,
					conflictToken: original.conflictToken,
				});
				const editInput = operationInput(editData);
				const saved = yield* saveWorkoutEditor(client, editInput);
				expect(saved.sets).toEqual<unknown>([{ eventId: originalSet.id, clientId: anyOf(String) }]);

				const replay = yield* saveWorkoutEditor(client, editInput);
				expect(replay.committed).toEqual(saved.committed);
				const stale = yield* Effect.flip(
					saveWorkoutEditor(client, {
						...editInput,
						submissionId: yield* randomUuid,
						submittedAt: DateTime.formatIso(yield* DateTime.now),
					}),
				);
				assertTaggedError(stale, "PluginConflictError");
				expect(stale.reason).toMatchObject({ code: "changes-conflict" });

				const edited = yield* loadWorkoutBaseline(client, workoutId);
				const editedSet = requirePresent(edited.baseline.sets[0], "Expected edited workout set");
				expect(edited.baseline.entity.properties).toMatchObject({
					activeDuration: 2400,
					images: media.images,
					videos: media.videos,
					exerciseMedia: [
						{ exerciseOrder: 0, images: media.occurrenceImages, videos: media.occurrenceVideos },
					],
				});
				expect(editedSet).toMatchObject({ id: originalSet.id, occurredAt: originalSet.occurredAt });
				expect(editedSet.properties).toMatchObject({ reps: 12, note: "Imported set note" });
				expect(editedSet.properties).not.toHaveProperty("images");
				expect(editedSet.properties).not.toHaveProperty("videos");

				const removeInput = operationInput(
					updateImportedWorkoutData({
						reps: 12,
						exerciseId,
						images: [],
						videos: [],
						occurrenceImages: [],
						occurrenceVideos: [],
						baseline: edited.baseline,
						conflictToken: edited.conflictToken,
					}),
				);
				yield* saveWorkoutEditor(client, removeInput);
				const withoutProtectedData = yield* loadWorkoutBaseline(client, workoutId);
				const remainingSet = requirePresent(
					withoutProtectedData.baseline.sets[0],
					"Expected the set after protected data removal",
				);
				expect(withoutProtectedData.baseline.entity.properties).toMatchObject({
					images: [],
					videos: [],
					exerciseMedia: [],
				});
				expect(remainingSet.properties).not.toHaveProperty("note");
			}),
	);

	it.live("reorders occurrence media with its exercise in a historical workout", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const firstImages: WorkoutOccurrenceInput["images"] = [
				{ type: "remote", url: "https://example.com/first.jpg" },
			];
			const firstVideos: WorkoutOccurrenceInput["videos"] = [
				{ type: "remote", url: "https://example.com/first.mp4" },
			];
			const secondImages: WorkoutOccurrenceInput["images"] = [
				{ type: "remote", url: "https://example.com/second.jpg" },
			];
			const secondVideos: WorkoutOccurrenceInput["videos"] = [
				{ type: "remote", url: "https://example.com/second.mp4" },
			];
			const created = yield* saveWorkoutData(
				client,
				workoutData({
					occurrences: [
						workoutOccurrence(exerciseId, [workoutSet()], {
							images: firstImages,
							videos: firstVideos,
						}),
						workoutOccurrence(exerciseId, [workoutSet()], {
							images: secondImages,
							videos: secondVideos,
						}),
					],
				}),
			);
			const original = yield* loadWorkoutBaseline(client, created.entityId);
			const firstSet = requirePresent(
				original.baseline.sets.find(({ properties }) => properties["exerciseOrder"] === 0),
				"Expected the first occurrence set",
			);
			const secondSet = requirePresent(
				original.baseline.sets.find(({ properties }) => properties["exerciseOrder"] === 1),
				"Expected the second occurrence set",
			);
			yield* saveWorkoutData(
				client,
				workoutData({
					target: editTarget(original),
					name: original.baseline.entity.name,
					occurrences: [
						workoutOccurrence(exerciseId, [keepSet(secondSet)], {
							images: secondImages,
							videos: secondVideos,
							sourceExerciseOrder: 1,
						}),
						workoutOccurrence(exerciseId, [keepSet(firstSet)], {
							images: firstImages,
							videos: firstVideos,
							sourceExerciseOrder: 0,
						}),
					],
				}),
			);
			const current = yield* loadWorkoutBaseline(client, created.entityId);
			expect(current.baseline.entity.properties["exerciseMedia"]).toMatchObject([
				{ exerciseOrder: 0, images: secondImages, videos: secondVideos },
				{ exerciseOrder: 1, images: firstImages, videos: firstVideos },
			]);
			expect(
				current.baseline.sets.map(({ id, properties }) => [id, properties["exerciseOrder"]]),
			).toEqual<unknown>(
				arrayContaining([
					[secondSet.id, 0],
					[firstSet.id, 1],
				]),
			);
		}),
	);

	it.live("loads context defaults and updates an exercise override", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const context = yield* loadWorkoutEditorContext(client);
			expect(context).toEqual({
				settings: {
					dropRestTime: 0,
					warmUpRestTime: 0,
					muteSounds: false,
					normalRestTime: 60,
					failureRestTime: 0,
					energyUnit: "kcal",
					unitSystem: "metric",
					promptForRestTimer: false,
					startTimerForDurationExercises: true,
				},
			});

			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const missing = yield* Effect.flip(
				updateExerciseOverrides(client, {
					overrides: { normalRestTime: 0 },
					exerciseId: EntityId.make(yield* randomUuid),
				}),
			);
			assertTaggedError(missing, "PluginOperationRejected");
			expect(missing.reason).toMatchObject({ key: "rejection.exercise-override.missing-exercise" });
			yield* saveWorkoutData(
				client,
				workoutData({ occurrences: [workoutOccurrence(exerciseId, [])] }),
			);
			yield* updateExerciseOverrides(client, { exerciseId, overrides: { normalRestTime: 45 } });
			const membership = yield* fitnessRecipes.execute(
				client,
				workoutEditorMembershipRecipe({ reference: yield* workoutReference(client) }),
				{ exerciseId },
			);
			expect(membership?.properties).toMatchObject({ normalRestTime: 45 });
			yield* updateExerciseOverrides(client, {
				exerciseId,
				overrides: { dropRestTime: 0, defaultDurationUnit: "minutes" },
			});
			expect(
				(yield* fitnessRecipes.execute(
					client,
					workoutEditorMembershipRecipe({ reference: yield* workoutReference(client) }),
					{ exerciseId },
				))?.properties,
			).toMatchObject({ dropRestTime: 0, normalRestTime: 45, defaultDurationUnit: "minutes" });
			yield* updateExerciseOverrides(client, {
				exerciseId,
				overrides: { normalRestTime: null, defaultDurationUnit: null },
			});
			expect(
				(yield* fitnessRecipes.execute(
					client,
					workoutEditorMembershipRecipe({ reference: yield* workoutReference(client) }),
					{ exerciseId },
				))?.properties,
			).toMatchObject({ dropRestTime: 0, normalRestTime: null, defaultDurationUnit: null });
		}),
	);

	it.live("blocks non-Pro template, set-note, and workout-media creation", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const template = templateData({
				occurrences: [
					{
						notes: [],
						exerciseId,
						images: [],
						videos: [],
						clientId: `occurrence-${yield* randomUuid}`,
						sets: [
							{
								setLot: "normal",
								clientId: `set-${yield* randomUuid}`,
								measurements: { reps: 8, weight: 30 },
							},
						],
					},
				],
			});
			expect(yield* Effect.flip(saveWorkoutEditor(client, operationInput(template)))).toEqual(
				entitlementRequired("pro"),
			);

			const notedSet = workoutData({
				occurrences: [workoutOccurrence(exerciseId, [workoutSet({ note: "New set note" })])],
			});
			expect(yield* Effect.flip(saveWorkoutData(client, notedSet))).toEqual(
				entitlementRequired("pro"),
			);

			const mediaWorkout = workoutData({
				images: [{ type: "remote", url: "https://example.com/workout.jpg" }],
			});
			expect(yield* Effect.flip(saveWorkoutData(client, mediaWorkout))).toEqual(
				entitlementRequired("pro"),
			);

			const occurrenceMediaWorkout = workoutData({
				occurrences: [
					workoutOccurrence(exerciseId, [workoutSet()], {
						images: [{ type: "remote", url: "https://example.com/exercise.jpg" }],
						videos: [{ type: "remote", url: "https://example.com/exercise.mp4" }],
					}),
				],
			});
			const occurrenceMediaSaved = yield* saveWorkoutData(client, occurrenceMediaWorkout);
			const occurrenceMediaBaseline = yield* loadWorkoutBaseline(
				client,
				occurrenceMediaSaved.entityId,
			);
			expect(occurrenceMediaBaseline.baseline.entity.properties["exerciseMedia"]).toMatchObject([
				{
					exerciseOrder: 0,
					images: [{ type: "remote", url: "https://example.com/exercise.jpg" }],
					videos: [{ type: "remote", url: "https://example.com/exercise.mp4" }],
				},
			]);
		}),
	);

	it.live("requires Pro to replace a set's exercise and rejects an unrelated event id", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const { exerciseId: originalExerciseId } = yield* createExerciseEntityFixture(client);
			const { exerciseId: replacementExerciseId } = yield* createExerciseEntityFixture(client);
			const created = yield* saveWorkoutData(
				client,
				workoutData({ occurrences: [workoutOccurrence(originalExerciseId, [workoutSet()])] }),
			);
			const baseline = yield* loadWorkoutBaseline(client, created.entityId);
			const originalSet = requirePresent(baseline.baseline.sets[0], "Expected the original set");
			const replacement = workoutData({
				startedAt,
				target: editTarget(baseline),
				name: baseline.baseline.entity.name,
				occurrences: [
					workoutOccurrence(replacementExerciseId, [keepSet(originalSet)], {
						sourceExerciseOrder: 0,
					}),
				],
			});
			expect(yield* Effect.flip(saveWorkoutData(client, replacement))).toEqual(
				entitlementRequired("pro"),
			);

			const unrelatedEvent = workoutData({
				target: editTarget(baseline),
				name: baseline.baseline.entity.name,
				occurrences: [
					workoutOccurrence(
						originalExerciseId,
						[
							workoutSet({
								occurredAt: originalSet.occurredAt,
								eventId: EventId.make("unrelated-event"),
							}),
						],
						{ sourceExerciseOrder: 0 },
					),
				],
			});
			const unrelated = yield* Effect.flip(saveWorkoutData(client, unrelatedEvent));
			assertTaggedError(unrelated, "PluginOperationRejected");
			expect(unrelated.reason).toMatchObject({ key: "rejection.workout-save.unrelated-event" });
		}),
	);

	it.live("keeps workout sets private across users for reads and saves", () =>
		Effect.gen(function* () {
			const { client: owner } = yield* createAuthenticatedClient(target);
			const { client: other } = yield* createAuthenticatedClient(target);
			const { exerciseId } = yield* createExerciseEntityFixture(owner);
			const created = yield* saveWorkoutData(
				owner,
				workoutData({ occurrences: [workoutOccurrence(exerciseId, [workoutSet()])] }),
			);
			const baseline = yield* loadWorkoutBaseline(owner, created.entityId);
			const otherReference = yield* workoutReference(other);

			expect(
				yield* fitnessRecipes.execute(
					other,
					workoutEditorEntityRecipe({ reference: otherReference }),
					{ kind: "workout", entityId: created.entityId },
				),
			).toBeNull();
			expect(
				(yield* fitnessRecipes.execute(
					other,
					workoutEditorSetsRecipe({ reference: otherReference }),
					{ workoutId: created.entityId },
				)).items,
			).toEqual([]);

			const originalSet = requirePresent(baseline.baseline.sets[0], "Expected owner's set");
			const foreignEdit = workoutData({
				target: editTarget(baseline),
				name: baseline.baseline.entity.name,
				occurrences: [
					workoutOccurrence(
						exerciseId,
						[keepSet(originalSet, { measurements: { reps: 1, weight: 1 } })],
						{ sourceExerciseOrder: 0 },
					),
				],
			});
			const foreign = yield* Effect.flip(saveWorkoutData(other, foreignEdit));
			assertTaggedError(foreign, "PluginConflictError");
			expect(foreign.reason).toMatchObject({ code: "changes-conflict" });
		}),
	);

	it.live(
		"corrects workout times, moving occurrences but not an unconfirmed set, and clears active duration",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient(target);
				const { exerciseId } = yield* createExerciseEntityFixture(client);
				const { workoutId } = yield* createImportedWorkout(client, exerciseId);
				const original = yield* loadWorkoutBaseline(client, workoutId);
				const originalSet = requirePresent(original.baseline.sets[0], "Expected imported set");
				const correctedStartedAt = "2026-10-01T09:00:00.000Z";
				const correctedEndedAt = "2026-10-01T10:00:00.000Z";

				const corrected = yield* correctWorkoutTimes(client, {
					entityId: workoutId,
					endedAt: correctedEndedAt,
					startedAt: correctedStartedAt,
					submissionId: yield* randomUuid,
					activeDuration: { kind: "preserve" },
					conflictToken: original.conflictToken,
					submittedAt: DateTime.formatIso(yield* DateTime.now),
				});
				expect(corrected).toEqual({ entityId: workoutId });
				const correctedBaseline = yield* loadWorkoutBaseline(client, workoutId);
				expect(correctedBaseline.baseline.entity.properties).toMatchObject({
					activeDuration: 2400,
					endedAt: correctedEndedAt,
					startedAt: correctedStartedAt,
				});
				expect(correctedBaseline.baseline.sets[0]?.occurredAt).toBe(originalSet.occurredAt);
				expect(
					(yield* readWorkoutOccurrences(client, exerciseId, workoutId)).map(
						({ occurredAt }) => occurredAt,
					),
				).toEqual([correctedStartedAt]);

				const zeroDuration = yield* correctWorkoutTimes(client, {
					entityId: workoutId,
					endedAt: correctedEndedAt,
					startedAt: correctedStartedAt,
					submissionId: yield* randomUuid,
					activeDuration: { seconds: 0, kind: "set" },
					conflictToken: correctedBaseline.conflictToken,
					submittedAt: DateTime.formatIso(yield* DateTime.now),
				});
				expect(zeroDuration).toEqual({ entityId: workoutId });
				const zeroBaseline = yield* loadWorkoutBaseline(client, workoutId);
				expect(zeroBaseline.baseline.entity.properties["activeDuration"]).toBe(0);

				const cleared = yield* correctWorkoutTimes(client, {
					entityId: workoutId,
					endedAt: correctedEndedAt,
					startedAt: correctedStartedAt,
					submissionId: yield* randomUuid,
					activeDuration: { kind: "clear" },
					conflictToken: zeroBaseline.conflictToken,
					submittedAt: DateTime.formatIso(yield* DateTime.now),
				});
				expect(cleared).toEqual({ entityId: workoutId });
				const clearedBaseline = yield* loadWorkoutBaseline(client, workoutId);
				expect(clearedBaseline.baseline.entity.properties).not.toHaveProperty("activeDuration");
				expect(clearedBaseline.baseline.sets[0]?.occurredAt).toBe(originalSet.occurredAt);
			}),
	);

	it.live(
		"pages 101 editor sets from production event writes",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient(target);
				const { exerciseId } = yield* createExerciseEntityFixture(client);
				const { created, workoutId } = yield* seedExerciseWorkout(client, {
					startedAt,
					exerciseId,
					timeoutMs: LARGE_WORKOUT_BUDGET.eventsMs,
					name: `Workout Editor Pagination ${yield* randomUuid}`,
					sets: Array.from({ length: 101 }, (_, reps) => ({
						occurredAt: setOccurredAt,
						properties: { reps, weight: 20, setLot: "normal", exerciseKind: "reps_and_weight" },
					})),
				});
				expect(created.count).toBe(101);

				const baseline = yield* loadWorkoutBaseline(client, workoutId);
				expect(baseline.baseline.sets).toHaveLength(101);
				expect(new Set(baseline.baseline.sets.map(({ id }) => id)).size).toBe(101);
			}),
		LARGE_WORKOUT_BUDGET.testMs,
	);
});
