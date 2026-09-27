import type { EntityId } from "@ryot-app/contract/schema/brands";
import { workoutListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import {
	encodeWorkoutEditorBaseline,
	type WorkoutEditorBaseline,
	workoutEditorEntityRecipe,
	workoutEditorMembershipRecipe,
	workoutEditorSetsRecipe,
} from "@ryot-app/fitness-plugin/workout-editor-recipes";
import { DateTime, Effect } from "effect";
import getPort from "get-port";

import {
	createAuthenticatedClient,
	createEntity,
	executeRyotQLRecipe,
	listEventsForEntity,
	waitForCreateEvents,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	createExerciseEntityFixture,
	correctWorkoutTimes,
	findFitnessEntitySchema,
	findWorkoutSetEventSchema,
	loadWorkoutEditorContext,
	saveWorkoutEditor,
	updateExerciseOverrides,
} from "~/fixtures/plugins/fitness";
import { assertCondition, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const startedAt = "2026-10-01T10:00:00.000Z";
const endedAt = "2026-10-01T11:00:00.000Z";
const setOccurredAt = "2026-10-01T10:15:00.000Z";

type SaveInput = Parameters<typeof saveWorkoutEditor>[1];
type WorkoutData = Extract<SaveInput["data"], { kind: "workout" }>;
type WorkoutSetInput = WorkoutData["occurrences"][number]["sets"][number];
type TemplateData = Extract<SaveInput["data"], { kind: "template" }>;

const workoutReference = (client: Client) =>
	findFitnessEntitySchema(client, "workout").pipe(
		Effect.map(({ pluginId }) => ({ pluginId, kind: "local" as const })),
	);

const loadWorkoutBaseline = (
	client: Client,
	entityId: string,
	kind: "workout" | "workout-template" = "workout",
) =>
	Effect.gen(function* () {
		const reference = yield* workoutReference(client);
		const entity = requirePresent(
			yield* executeRyotQLRecipe(client, workoutEditorEntityRecipe({ kind, entityId, reference })),
			`Expected workout editor entity ${entityId}`,
		);
		const sets: WorkoutEditorBaseline["sets"][number][] = [];
		let after: string | undefined;
		let hasMore: boolean;
		do {
			const page = yield* executeRyotQLRecipe(
				client,
				workoutEditorSetsRecipe({ after, reference, workoutId: entityId }),
			);
			sets.push(...page.items);
			hasMore = page.pageInfo.hasMore;
			if (hasMore) {
				after = requirePresent(page.pageInfo.nextCursor, "Expected the next workout set cursor");
			}
		} while (hasMore);
		const baseline = { sets, entity };
		return { baseline, conflictToken: encodeWorkoutEditorBaseline(baseline) };
	});

const workoutData = (overrides: Partial<WorkoutData> = {}): WorkoutData => ({
	startedAt,
	images: [],
	videos: [],
	supersets: [],
	kind: "workout",
	occurrences: [],
	target: { kind: "create" },
	activeDuration: { kind: "preserve" },
	name: `Workout Editor ${crypto.randomUUID()}`,
	...overrides,
});

const workoutSet = (overrides: Partial<WorkoutSetInput> = {}): WorkoutSetInput => ({
	images: [],
	videos: [],
	setLot: "normal",
	occurredAt: setOccurredAt,
	confirmedAt: setOccurredAt,
	exerciseKind: "reps_and_weight",
	measurements: { reps: 0, weight: 0 },
	clientId: `set-${crypto.randomUUID()}`,
	...overrides,
});

const workoutOccurrence = (
	exerciseId: string,
	sets: WorkoutSetInput[],
	overrides: Partial<WorkoutData["occurrences"][number]> = {},
): WorkoutData["occurrences"][number] => ({
	sets,
	notes: [],
	exerciseId,
	clientId: `occurrence-${crypto.randomUUID()}`,
	...overrides,
});

const templateData = (exerciseId: string): TemplateData => ({
	images: [],
	videos: [],
	supersets: [],
	kind: "template",
	target: { kind: "create" },
	name: `Workout Template ${crypto.randomUUID()}`,
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

const operationInput = (
	data: SaveInput["data"],
	submissionId: SaveInput["submissionId"] = crypto.randomUUID(),
	submittedAt = new Date().toISOString(),
): SaveInput => ({ data, submittedAt, submissionId });

const workoutSave = (client: Client, data: WorkoutData, submissionId?: SaveInput["submissionId"]) =>
	saveWorkoutEditor(client, operationInput(data, submissionId));

const S3_BUCKET_NAME = "ryot-workout-editor-keyless-test";

let apiUrl: string;
let apiProcess: ReturnType<typeof spawnApiProcess> | undefined;
let coreInfrastructure: Effect.Success<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			coreInfrastructure = yield* startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME });
			const infrastructure = requirePresent(
				coreInfrastructure,
				"Workout editor keyless test infrastructure is not initialised",
			);
			const port = yield* Effect.promise(() => getPort());
			const apiOrigin = `http://127.0.0.1:${port}`;
			apiUrl = `${apiOrigin}/api`;
			apiProcess = spawnApiProcess(
				buildApiEnv({
					port,
					frontendUrl: apiOrigin,
					dbUrl: infrastructure.dbUrl,
					s3BucketName: S3_BUCKET_NAME,
					label: "Workout editor keyless",
					extraEnv: { SERVER_PRO_KEY: "" },
					redisUrl: infrastructure.redisUrl,
					s3Endpoint: infrastructure.s3Endpoint,
				}),
			);
			yield* waitForHealthCheck(
				`${apiOrigin}/api/system/health`,
				"Workout editor keyless setup",
				apiProcess,
				90,
			);
		}),
	),
);

afterAll(() =>
	runPromise(
		Effect.gen(function* () {
			yield* stopApiProcess(apiProcess);
			yield* stopCoreTestInfrastructure(coreInfrastructure);
		}),
	),
);

const createImportedWorkout = (client: Client, exerciseId: EntityId) =>
	Effect.gen(function* () {
		const { schema } = yield* findFitnessEntitySchema(client, "workout");
		const workout = yield* createEntity(client, {
			entitySchema: schema.reference,
			name: `Imported Workout ${crypto.randomUUID()}`,
			properties: {
				endedAt,
				startedAt,
				activeDuration: 2400,
				videos: [{ type: "s3", key: "workouts/imported-workout.mp4" }],
				images: [{ type: "local", key: "permanent/imported-workout.jpg" }],
				exerciseNotes: [{ exerciseOrder: 0, notes: ["Imported exercise note"] }],
			},
		});
		const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
		const response = yield* client.call((contract) =>
			contract.events.create({
				payload: [
					{
						entityId: exerciseId,
						occurredAt: setOccurredAt,
						sessionEntityId: workout.id,
						eventSchemaSlug: workoutSetEventSchema.id,
						properties: {
							reps: 10,
							weight: 40,
							setOrder: 0,
							restTime: 90,
							setLot: "normal",
							exerciseOrder: 0,
							note: "Imported set note",
							exerciseKind: "reps_and_weight",
							videos: [{ type: "s3", key: "workouts/imported-set.mp4" }],
							images: [{ type: "local", key: "permanent/imported-set.jpg" }],
						},
					},
				],
			}),
		);
		yield* waitForCreateEvents(client, response);
		return { workoutId: workout.id };
	});

const importedWorkoutImages: WorkoutData["images"] = [
	{ type: "local", key: "permanent/imported-workout.jpg" },
];
const importedWorkoutVideos: WorkoutData["videos"] = [
	{ type: "s3", key: "workouts/imported-workout.mp4" },
];
const importedSetImages: WorkoutSetInput["images"] = [
	{ type: "local", key: "permanent/imported-set.jpg" },
];
const importedSetVideos: WorkoutSetInput["videos"] = [
	{ type: "s3", key: "workouts/imported-set.mp4" },
];

const updateImportedWorkoutData = (input: {
	readonly baseline: WorkoutEditorBaseline;
	readonly conflictToken: string;
	readonly exerciseId: string;
	readonly note?: string | undefined;
	readonly reps: number;
	readonly images: WorkoutData["images"];
	readonly videos: WorkoutData["videos"];
	readonly setImages: WorkoutSetInput["images"];
	readonly setVideos: WorkoutSetInput["videos"];
}): WorkoutData => {
	const originalSet = requirePresent(input.baseline.sets[0], "Expected the imported workout set");
	return workoutData({
		endedAt,
		startedAt,
		images: input.images,
		videos: input.videos,
		name: input.baseline.entity.name,
		activeDuration: { kind: "preserve" },
		target: {
			kind: "update",
			entityId: input.baseline.entity.id,
			conflictToken: input.conflictToken,
		},
		occurrences: [
			workoutOccurrence(
				input.exerciseId,
				[
					workoutSet({
						restTime: 90,
						confirmedAt: undefined,
						eventId: originalSet.id,
						occurredAt: originalSet.occurredAt,
						measurements: { weight: 40, reps: input.reps },
						...(input.note === undefined ? {} : { note: input.note }),
						images: input.setImages,
						videos: input.setVideos,
					}),
				],
				{ sourceExerciseOrder: 0, notes: ["Imported exercise note"] },
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
				workoutListRecipe({ reference, limit: 100 }),
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

	it.live(
		"edits through a full baseline, replays the immutable edit, and rejects stale edits",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient(apiUrl);
				const { exerciseId } = yield* createExerciseEntityFixture(client);
				const { workoutId } = yield* createImportedWorkout(client, exerciseId);
				const original = yield* loadWorkoutBaseline(client, workoutId);
				const originalSet = requirePresent(original.baseline.sets[0], "Expected imported set");
				const editData = updateImportedWorkoutData({
					reps: 12,
					exerciseId,
					note: "Imported set note",
					baseline: original.baseline,
					setImages: importedSetImages,
					setVideos: importedSetVideos,
					images: importedWorkoutImages,
					videos: importedWorkoutVideos,
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
					images: importedWorkoutImages,
					videos: importedWorkoutVideos,
				});
				expect(editedSet).toMatchObject({ id: originalSet.id, occurredAt: originalSet.occurredAt });
				expect(editedSet.properties).toMatchObject({
					reps: 12,
					note: "Imported set note",
					images: importedSetImages,
					videos: importedSetVideos,
				});

				const removeInput = operationInput(
					updateImportedWorkoutData({
						reps: 12,
						exerciseId,
						images: [],
						videos: [],
						setImages: [],
						setVideos: [],
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
				});
				expect(remainingSet.properties).not.toHaveProperty("note");
				expect(remainingSet.properties).toMatchObject({ images: [], videos: [] });
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
			const membershipWorkout = yield* workoutSave(
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
			expect(yield* saveWorkoutEditor(client, operationInput(templateData(exerciseId)))).toEqual({
				kind: "pro-required",
			});

			const notedSet = workoutData({
				occurrences: [workoutOccurrence(exerciseId, [workoutSet({ note: "New set note" })])],
			});
			expect(yield* workoutSave(client, notedSet)).toEqual({ kind: "pro-required" });

			const mediaWorkout = workoutData({
				images: [{ type: "remote", url: "https://example.com/workout.jpg" }],
			});
			expect(yield* workoutSave(client, mediaWorkout)).toEqual({ kind: "pro-required" });
		}),
	);

	it.live("requires Pro to replace a set's exercise and rejects an unrelated event id", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(apiUrl);
			const { exerciseId: originalExerciseId } = yield* createExerciseEntityFixture(client);
			const { exerciseId: replacementExerciseId } = yield* createExerciseEntityFixture(client);
			const created = yield* workoutSave(
				client,
				workoutData({ occurrences: [workoutOccurrence(originalExerciseId, [workoutSet()])] }),
			);
			assertCondition(created.kind === "saved", "Expected initial workout save");
			const baseline = yield* loadWorkoutBaseline(client, created.entityId);
			const originalSet = requirePresent(baseline.baseline.sets[0], "Expected the original set");
			const replacement = workoutData({
				startedAt,
				name: baseline.baseline.entity.name,
				target: {
					kind: "update",
					entityId: created.entityId,
					conflictToken: baseline.conflictToken,
				},
				occurrences: [
					workoutOccurrence(
						replacementExerciseId,
						[
							workoutSet({
								eventId: originalSet.id,
								confirmedAt: setOccurredAt,
								occurredAt: originalSet.occurredAt,
								measurements: { reps: 0, weight: 0 },
							}),
						],
						{ sourceExerciseOrder: 0 },
					),
				],
			});
			expect(yield* workoutSave(client, replacement)).toEqual({ kind: "pro-required" });

			const unrelatedEvent = workoutData({
				name: baseline.baseline.entity.name,
				target: {
					kind: "update",
					entityId: created.entityId,
					conflictToken: baseline.conflictToken,
				},
				occurrences: [
					workoutOccurrence(
						originalExerciseId,
						[
							workoutSet({
								eventId: "unrelated-event",
								confirmedAt: setOccurredAt,
								occurredAt: originalSet.occurredAt,
								measurements: { reps: 0, weight: 0 },
							}),
						],
						{ sourceExerciseOrder: 0 },
					),
				],
			});
			expect(yield* workoutSave(client, unrelatedEvent)).toEqual({
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
			const created = yield* workoutSave(
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
				name: baseline.baseline.entity.name,
				target: {
					kind: "update",
					entityId: created.entityId,
					conflictToken: baseline.conflictToken,
				},
				occurrences: [
					workoutOccurrence(
						exerciseId,
						[
							workoutSet({
								eventId: originalSet.id,
								occurredAt: originalSet.occurredAt,
								measurements: { reps: 1, weight: 1 },
							}),
						],
						{ sourceExerciseOrder: 0 },
					),
				],
			});
			expect(yield* workoutSave(other, foreignEdit)).toEqual({ kind: "conflict" });
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

	it.live("pages 101 editor sets from production event writes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(apiUrl);
			const { schema } = yield* findFitnessEntitySchema(client, "workout");
			const workout = yield* createEntity(client, {
				properties: { startedAt },
				entitySchema: schema.reference,
				name: `Workout Editor Pagination ${crypto.randomUUID()}`,
			});
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
			const response = yield* client.call((contract) =>
				contract.events.create({
					payload: Array.from({ length: 101 }, (_, setOrder) => ({
						entityId: exerciseId,
						occurredAt: setOccurredAt,
						sessionEntityId: workout.id,
						eventSchemaSlug: workoutSetEventSchema.id,
						properties: {
							setOrder,
							weight: 20,
							reps: setOrder,
							setLot: "normal",
							exerciseOrder: 0,
							exerciseKind: "reps_and_weight",
						},
					})),
				}),
			);
			const created = yield* waitForCreateEvents(client, response, 600_000);
			expect(created.count).toBe(101);

			const baseline = yield* loadWorkoutBaseline(client, workout.id);
			expect(baseline.baseline.sets).toHaveLength(101);
			expect(new Set(baseline.baseline.sets.map(({ id }) => id)).size).toBe(101);
		}),
	);
});
