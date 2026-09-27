import type { EntityId } from "@ryot-app/contract/schema/brands";
import {
	encodeWorkoutEditorBaseline,
	type WorkoutEditorBaseline,
	workoutEditorEntityRecipe,
	workoutEditorLinksRecipe,
	workoutEditorSetsRecipe,
} from "@ryot-app/fitness-plugin/workout-editor-recipes";
import { DateTime, Effect } from "effect";
import getPort from "get-port";

import { createAuthenticatedClient, executeRyotQLRecipe } from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	createExerciseEntityFixture,
	findFitnessEntitySchema,
	saveWorkoutEditor,
} from "~/fixtures/plugins/fitness";
import { assertCondition, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { type FakeHttpServer, startFakeHttpServer } from "~/support/fake-http-server";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const S3_BUCKET_NAME = "ryot-workout-editor-pro-test";
const PRO_KEY_ENV_VALUE = "e2e-workout-editor-pro-key";
const startedAt = "2026-10-01T10:00:00.000Z";
const occurredAt = "2026-10-01T10:15:00.000Z";

type SaveInput = Parameters<typeof saveWorkoutEditor>[1];
type WorkoutData = Extract<SaveInput["data"], { kind: "workout" }>;
type WorkoutSetInput = WorkoutData["occurrences"][number]["sets"][number];
type TemplateData = Extract<SaveInput["data"], { kind: "template" }>;

const unkeyEnvelope = (data: {
	readonly valid: boolean;
	readonly code: string;
	readonly meta?: Record<string, unknown>;
}) => Response.json({ data, meta: { requestId: crypto.randomUUID() } });

const workoutReference = (client: Client) =>
	findFitnessEntitySchema(client, "workout").pipe(
		Effect.map(({ pluginId }) => ({ pluginId, kind: "local" as const })),
	);

const loadEditorBaseline = (
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
	name: `Pro Workout ${crypto.randomUUID()}`,
	...overrides,
});

const workoutSet = (overrides: Partial<WorkoutSetInput> = {}): WorkoutSetInput => ({
	setLot: "normal",
	occurredAt: occurredAt,
	confirmedAt: occurredAt,
	exerciseKind: "reps_and_weight",
	measurements: { reps: 0, weight: 0 },
	clientId: `set-${crypto.randomUUID()}`,
	...overrides,
});

const workoutOccurrence = (
	exerciseId: EntityId,
	sets: WorkoutSetInput[],
	overrides: Partial<WorkoutData["occurrences"][number]> = {},
): WorkoutData["occurrences"][number] => ({
	sets,
	notes: [],
	images: [],
	videos: [],
	exerciseId,
	clientId: `occurrence-${crypto.randomUUID()}`,
	...overrides,
});

const templateData = (overrides: Partial<TemplateData> = {}): TemplateData => ({
	images: [],
	videos: [],
	supersets: [],
	occurrences: [],
	kind: "template",
	target: { kind: "create" },
	name: `Pro Workout Template ${crypto.randomUUID()}`,
	...overrides,
});

const operationInput = (
	data: SaveInput["data"],
	submissionId = crypto.randomUUID(),
	submittedAt = new Date().toISOString(),
): SaveInput => ({ data, submittedAt, submissionId });

let apiUrl: string;
let apiProcess: ReturnType<typeof spawnApiProcess> | undefined;
let fakeUnkey: FakeHttpServer | undefined;
let coreInfrastructure: Effect.Success<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			coreInfrastructure = yield* startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME });
			const infrastructure = requirePresent(
				coreInfrastructure,
				"Workout editor Pro test infrastructure is not initialised",
			);
			fakeUnkey = yield* startFakeHttpServer(() =>
				unkeyEnvelope({ valid: true, code: "VALID", meta: { expiry: "2030-01-01" } }),
			);
			const port = yield* Effect.promise(() => getPort());
			const apiOrigin = `http://127.0.0.1:${port}`;
			apiUrl = `${apiOrigin}/api`;
			apiProcess = spawnApiProcess(
				buildApiEnv({
					port,
					frontendUrl: apiOrigin,
					label: "Workout editor Pro",
					dbUrl: infrastructure.dbUrl,
					s3BucketName: S3_BUCKET_NAME,
					redisUrl: infrastructure.redisUrl,
					s3Endpoint: infrastructure.s3Endpoint,
					extraEnv: {
						SERVER_PRO_KEY: PRO_KEY_ENV_VALUE,
						SERVER_PRO_KEY_VERIFICATION_URL: fakeUnkey.url,
					},
				}),
			);
			yield* waitForHealthCheck(
				`${apiOrigin}/api/system/health`,
				"Workout editor Pro setup",
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
			const server = fakeUnkey;
			if (server) {
				yield* Effect.promise(() => server.stop());
			}
			yield* stopCoreTestInfrastructure(coreInfrastructure);
		}),
	),
);

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
				const baseline = yield* loadEditorBaseline(client, created.entityId, "workout-template");
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
						target: {
							kind: "update",
							entityId: created.entityId,
							conflictToken: baseline.conflictToken,
						},
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

				const current = yield* loadEditorBaseline(client, created.entityId, "workout-template");
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
			const baseline = yield* loadEditorBaseline(client, created.entityId);
			const originalSet = requirePresent(
				baseline.baseline.sets[0],
				"Expected the confirmed source set",
			);
			const replacementData = (exerciseId: EntityId, conflictToken: string): WorkoutData =>
				workoutData({
					name: baseline.baseline.entity.name,
					target: { conflictToken, kind: "update", entityId: created.entityId },
					occurrences: [
						workoutOccurrence(
							exerciseId,
							[
								workoutSet({
									eventId: originalSet.id,
									confirmedAt: occurredAt,
									occurredAt: originalSet.occurredAt,
									measurements: { reps: 0, weight: 0 },
								}),
							],
							{
								sourceExerciseOrder: 0,
								images: [{ type: "remote", url: "https://example.com/replacement.jpg" }],
								videos: [{ type: "remote", url: "https://example.com/replacement.mp4" }],
							},
						),
					],
				});

			const replaced = yield* saveWorkoutEditor(
				client,
				operationInput(replacementData(replacementExerciseId, baseline.conflictToken)),
			);
			expect(replaced).toMatchObject({ kind: "saved" });
			assertCondition(replaced.kind === "saved", "Expected compatible Pro replacement to save");
			expect(replaced.sets.map(({ eventId }) => eventId)).toEqual([originalSet.id]);
			const replacedBaseline = yield* loadEditorBaseline(client, created.entityId);
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
				operationInput(replacementData(incompatibleExerciseId, replacedBaseline.conflictToken)),
			);
			expect(incompatible).toEqual({
				canEdit: true,
				kind: "invalid",
				code: "invalid-exercise-kind",
			});
			const unchanged = yield* loadEditorBaseline(client, created.entityId);
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
			const notedBaseline = yield* loadEditorBaseline(client, noted.entityId);
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
