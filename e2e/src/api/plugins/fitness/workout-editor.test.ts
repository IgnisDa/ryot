import { EventId, SignalSchemaSlug, UserId, type EntityId } from "@ryot-app/contract/schema/brands";
import {
	type WorkoutEditorBaseline,
	workoutEditorEntityRecipe,
	workoutEditorMembershipRecipe,
	workoutEditorSetsRecipe,
} from "@ryot-app/fitness-plugin/workout-editor-recipes";
import { workoutCardsRecipe } from "@ryot-app/fitness-plugin/workout-list-recipes";
import { DateTime, Effect, Exit, Scope } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
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
	type WorkoutOccurrenceInput,
	workoutData,
	workoutEditorTimes,
	workoutOccurrence,
	workoutReference,
	workoutSet,
} from "~/fixtures/plugins/fitness";
import { assertCondition, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { startIsolatedApiServer } from "~/support/isolated-harness";

const { endedAt, startedAt, setOccurredAt } = workoutEditorTimes;

const scope = Scope.makeUnsafe();
let apiUrl: string;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			const server = yield* startIsolatedApiServer({
				label: "Workout editor keyless",
				extraEnv: { SERVER_PRO_KEY: "" },
			});
			apiUrl = server.apiUrl;
		}).pipe(
			Effect.provideService(Scope.Scope, scope),
			Effect.onError(() => Scope.close(scope, Exit.void)),
		),
	),
);

afterAll(() => runPromise(Scope.close(scope, Exit.void)));

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
			name: `Imported Workout ${crypto.randomUUID()}`,
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
	readonly baseline: WorkoutEditorBaseline;
	readonly conflictToken: string;
	readonly exerciseId: EntityId;
	readonly note?: string | undefined;
	readonly reps: number;
	readonly images: WorkoutData["images"];
	readonly videos: WorkoutData["videos"];
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
					keepSet(originalSet, {
						restTime: 90,
						confirmedAt: undefined,
						measurements: { weight: 40, reps: input.reps },
						...(input.note === undefined ? {} : { note: input.note }),
					}),
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
			const { client } = yield* createAuthenticatedClient(apiUrl);
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const name = `Workout Editor Retry ${crypto.randomUUID()}`;
			const submissionId = crypto.randomUUID();
			const input = operationInput(
				workoutData({ name, occurrences: [workoutOccurrence(exerciseId, [workoutSet()])] }),
				submissionId,
			);

			const saved = yield* saveWorkoutEditor(client, input);
			assertCondition(saved.kind === "saved", "Expected a completed workout save");
			const [retry, concurrent] = yield* Effect.all(
				[saveWorkoutEditor(client, input), saveWorkoutEditor(client, input)],
				{ concurrency: "unbounded" },
			);
			expect(retry).toEqual(saved);
			expect(concurrent).toEqual(saved);

			const changed = { ...input, data: { ...input.data, name: `${name} changed` } };
			expect(yield* saveWorkoutEditor(client, changed)).toEqual({ kind: "conflict" });

			const reference = yield* workoutReference(client);
			const workouts = yield* executeRyotQLRecipe(
				client,
				workoutCardsRecipe({ reference, search: name }),
			);
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
			assertCondition(created.kind === "saved", "Expected the new workout to save");

			const signal = yield* pollSignalTrigger(filter);
			expect(signal.payload.properties["workoutId"]).toBe(created.entityId);
			expect(yield* listSignalTriggers(filter)).toHaveLength(1);

			const baseline = yield* loadWorkoutBaseline(client, created.entityId);
			const originalSet = requirePresent(baseline.baseline.sets[0], "Expected the created set");
			const editedName = `${baseline.baseline.entity.name} edited`;
			const edited = yield* saveWorkoutData(
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
			assertCondition(edited.kind === "saved", "Expected the workout edit to save");
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
				const { client } = yield* createAuthenticatedClient(apiUrl);
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
				assertCondition(saved.kind === "saved", "Expected the historical workout edit to save");
				expect(saved.sets).toEqual([{ eventId: originalSet.id, clientId: expect.any(String) }]);

				const replay = yield* saveWorkoutEditor(client, editInput);
				expect(replay).toEqual(saved);
				const stale = yield* saveWorkoutEditor(client, {
					...editInput,
					submissionId: crypto.randomUUID(),
					submittedAt: DateTime.formatIso(yield* DateTime.now),
				});
				expect(stale).toEqual({ kind: "conflict" });

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
				const removed = yield* saveWorkoutEditor(client, removeInput);
				assertCondition(removed.kind === "saved", "Expected protected data removal to save");
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
			const { client } = yield* createAuthenticatedClient(apiUrl);
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
			assertCondition(created.kind === "saved", "Expected workout creation with occurrence media");
			const original = yield* loadWorkoutBaseline(client, created.entityId);
			const firstSet = requirePresent(
				original.baseline.sets.find(({ properties }) => properties["exerciseOrder"] === 0),
				"Expected the first occurrence set",
			);
			const secondSet = requirePresent(
				original.baseline.sets.find(({ properties }) => properties["exerciseOrder"] === 1),
				"Expected the second occurrence set",
			);
			const reordered = yield* saveWorkoutData(
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
			assertCondition(reordered.kind === "saved", "Expected workout reordering to save");
			const current = yield* loadWorkoutBaseline(client, created.entityId);
			expect(current.baseline.entity.properties["exerciseMedia"]).toMatchObject([
				{ exerciseOrder: 0, images: secondImages, videos: secondVideos },
				{ exerciseOrder: 1, images: firstImages, videos: firstVideos },
			]);
			expect(
				current.baseline.sets.map(({ id, properties }) => [id, properties["exerciseOrder"]]),
			).toEqual(
				expect.arrayContaining([
					[secondSet.id, 0],
					[firstSet.id, 1],
				]),
			);
		}),
	);

	it.live("loads context defaults and updates an exercise override", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(apiUrl);
			const context = yield* loadWorkoutEditorContext(client, {});
			expect(context).toEqual({
				proAvailable: false,
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
			const membershipWorkout = yield* saveWorkoutData(
				client,
				workoutData({ occurrences: [workoutOccurrence(exerciseId, [])] }),
			);
			assertCondition(membershipWorkout.kind === "saved", "Expected membership workout save");
			expect(
				yield* updateExerciseOverrides(client, {
					exerciseId,
					remove: [],
					set: { normalRestTime: 45 },
				}),
			).toEqual({ kind: "saved" });
			const membership = yield* executeRyotQLRecipe(
				client,
				workoutEditorMembershipRecipe({ exerciseId, reference: yield* workoutReference(client) }),
			);
			expect(membership?.properties).toMatchObject({ normalRestTime: 45 });
		}),
	);

	it.live("blocks non-Pro template, set-note, and workout-media creation", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(apiUrl);
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const template = templateData({
				occurrences: [
					{
						notes: [],
						exerciseId,
						images: [],
						videos: [],
						clientId: `occurrence-${crypto.randomUUID()}`,
						sets: [
							{
								setLot: "normal",
								measurements: { reps: 8, weight: 30 },
								clientId: `set-${crypto.randomUUID()}`,
							},
						],
					},
				],
			});
			expect(yield* saveWorkoutEditor(client, operationInput(template))).toEqual({
				canEdit: true,
				kind: "pro-required",
			});

			const notedSet = workoutData({
				occurrences: [workoutOccurrence(exerciseId, [workoutSet({ note: "New set note" })])],
			});
			expect(yield* saveWorkoutData(client, notedSet)).toEqual({
				canEdit: true,
				kind: "pro-required",
			});

			const mediaWorkout = workoutData({
				images: [{ type: "remote", url: "https://example.com/workout.jpg" }],
			});
			expect(yield* saveWorkoutData(client, mediaWorkout)).toEqual({
				canEdit: true,
				kind: "pro-required",
			});

			const occurrenceMediaWorkout = workoutData({
				occurrences: [
					workoutOccurrence(exerciseId, [workoutSet()], {
						images: [{ type: "remote", url: "https://example.com/exercise.jpg" }],
						videos: [{ type: "remote", url: "https://example.com/exercise.mp4" }],
					}),
				],
			});
			const occurrenceMediaSaved = yield* saveWorkoutData(client, occurrenceMediaWorkout);
			assertCondition(
				occurrenceMediaSaved.kind === "saved",
				"Expected occurrence media to save without Pro",
			);
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
			const { client } = yield* createAuthenticatedClient(apiUrl);
			const { exerciseId: originalExerciseId } = yield* createExerciseEntityFixture(client);
			const { exerciseId: replacementExerciseId } = yield* createExerciseEntityFixture(client);
			const created = yield* saveWorkoutData(
				client,
				workoutData({ occurrences: [workoutOccurrence(originalExerciseId, [workoutSet()])] }),
			);
			assertCondition(created.kind === "saved", "Expected initial workout save");
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
			expect(yield* saveWorkoutData(client, replacement)).toEqual({
				canEdit: true,
				kind: "pro-required",
			});

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
			expect(yield* saveWorkoutData(client, unrelatedEvent)).toEqual({
				canEdit: true,
				kind: "invalid",
				code: "unrelated-event",
			});
		}),
	);

	it.live("keeps workout sets private across users for reads and saves", () =>
		Effect.gen(function* () {
			const { client: owner } = yield* createAuthenticatedClient(apiUrl);
			const { client: other } = yield* createAuthenticatedClient(apiUrl);
			const { exerciseId } = yield* createExerciseEntityFixture(owner);
			const created = yield* saveWorkoutData(
				owner,
				workoutData({ occurrences: [workoutOccurrence(exerciseId, [workoutSet()])] }),
			);
			assertCondition(created.kind === "saved", "Expected owner workout save");
			const baseline = yield* loadWorkoutBaseline(owner, created.entityId);
			const otherReference = yield* workoutReference(other);

			expect(
				yield* executeRyotQLRecipe(
					other,
					workoutEditorEntityRecipe({
						kind: "workout",
						reference: otherReference,
						entityId: created.entityId,
					}),
				),
			).toBeNull();
			expect(
				(yield* executeRyotQLRecipe(
					other,
					workoutEditorSetsRecipe({ reference: otherReference, workoutId: created.entityId }),
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
			expect(yield* saveWorkoutData(other, foreignEdit)).toEqual({
				canEdit: true,
				kind: "conflict",
			});
		}),
	);

	it.live(
		"corrects workout times without moving an unconfirmed set and clears active duration",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient(apiUrl);
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
					submissionId: crypto.randomUUID(),
					activeDuration: { kind: "preserve" },
					conflictToken: original.conflictToken,
					submittedAt: DateTime.formatIso(yield* DateTime.now),
				});
				expect(corrected).toEqual({ kind: "saved", entityId: workoutId });
				const correctedBaseline = yield* loadWorkoutBaseline(client, workoutId);
				expect(correctedBaseline.baseline.entity.properties).toMatchObject({
					activeDuration: 2400,
					endedAt: correctedEndedAt,
					startedAt: correctedStartedAt,
				});
				expect(correctedBaseline.baseline.sets[0]?.occurredAt).toBe(originalSet.occurredAt);

				const zeroDuration = yield* correctWorkoutTimes(client, {
					entityId: workoutId,
					endedAt: correctedEndedAt,
					startedAt: correctedStartedAt,
					submissionId: crypto.randomUUID(),
					activeDuration: { seconds: 0, kind: "set" },
					conflictToken: correctedBaseline.conflictToken,
					submittedAt: DateTime.formatIso(yield* DateTime.now),
				});
				expect(zeroDuration).toEqual({ kind: "saved", entityId: workoutId });
				const zeroBaseline = yield* loadWorkoutBaseline(client, workoutId);
				expect(zeroBaseline.baseline.entity.properties["activeDuration"]).toBe(0);

				const cleared = yield* correctWorkoutTimes(client, {
					entityId: workoutId,
					endedAt: correctedEndedAt,
					startedAt: correctedStartedAt,
					activeDuration: { kind: "clear" },
					submissionId: crypto.randomUUID(),
					conflictToken: zeroBaseline.conflictToken,
					submittedAt: DateTime.formatIso(yield* DateTime.now),
				});
				expect(cleared).toEqual({ kind: "saved", entityId: workoutId });
				const clearedBaseline = yield* loadWorkoutBaseline(client, workoutId);
				expect(clearedBaseline.baseline.entity.properties).not.toHaveProperty("activeDuration");
				expect(clearedBaseline.baseline.sets[0]?.occurredAt).toBe(originalSet.occurredAt);
			}),
	);

	it.live(
		"pages 101 editor sets from production event writes",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient(apiUrl);
				const { exerciseId } = yield* createExerciseEntityFixture(client);
				const { created, workoutId } = yield* seedExerciseWorkout(client, {
					startedAt,
					exerciseId,
					timeoutMs: LARGE_WORKOUT_BUDGET.eventsMs,
					name: `Workout Editor Pagination ${crypto.randomUUID()}`,
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
