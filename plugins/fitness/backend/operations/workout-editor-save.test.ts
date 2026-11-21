import { describe, expect, it } from "bun:test";

import { EntitlementRequiredError } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { assert } from "@ryot-app/testing/assert";
import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";

import { WorkoutEditorSaveInputSchema } from "../../shared/workout-editor-operations";
import {
	encodeWorkoutEditorBaseline,
	type WorkoutEditorBaseline,
	type WorkoutEditorEvent,
	type WorkoutEditorExercise,
} from "../../shared/workout-editor-recipes";
import definition, { manifest } from "./workout-editor-save.sandbox";

const time = "2026-10-01T10:00:00.000Z";
const setTime = "2026-10-01T10:15:00.000Z";
const entityId = EntityId.make("workout-1");
const exerciseId = EntityId.make("exercise-1");
const occurrenceImages = [{ type: "local", key: "permanent/imported-exercise.jpg" }];
const occurrenceVideos = [{ type: "remote", url: "https://example.com/imported-exercise.mp4" }];
const original: WorkoutEditorEvent = {
	occurredAt: setTime,
	entityId: exerciseId,
	sessionEntityId: entityId,
	id: EventId.make("set-1"),
	properties: {
		reps: 10,
		weight: 50,
		setOrder: 0,
		setLot: "normal",
		exerciseOrder: 0,
		note: "Imported note",
		exerciseKind: "reps_and_weight",
	},
};
const baseline: WorkoutEditorBaseline = {
	sets: [original],
	entity: {
		id: entityId,
		name: "Workout",
		updatedAt: time,
		properties: {
			startedAt: time,
			activeDuration: 3000,
			images: [{ type: "s3", key: "existing.jpg" }],
			exerciseMedia: [{ exerciseOrder: 0, images: occurrenceImages, videos: occurrenceVideos }],
		},
	},
};

const input = Effect.fnUntraced(function* (update = false) {
	return yield* Schema.decodeUnknownEffect(WorkoutEditorSaveInputSchema)({
		submissionId: "submission-1",
		submittedAt: "2026-10-15T10:00:00.000Z",
		data: {
			videos: [],
			supersets: [],
			kind: "workout",
			name: "Workout",
			startedAt: time,
			activeDuration: { kind: "preserve" },
			images: update ? baseline.entity.properties["images"] : [],
			target: update
				? {
						entityId,
						kind: "update",
						conflictToken: yield* Effect.fromResult(encodeWorkoutEditorBaseline(baseline)),
					}
				: { kind: "create" },
			occurrences: [
				{
					exerciseId,
					notes: ["Exercise note"],
					clientId: "occurrence-1",
					images: update ? occurrenceImages : [],
					videos: update ? occurrenceVideos : [],
					sourceExerciseOrder: update ? 0 : undefined,
					sets: [
						{
							setLot: "normal",
							occurredAt: setTime,
							clientId: "client-set-1",
							exerciseKind: "reps_and_weight",
							measurements: { reps: 0, weight: 0 },
							eventId: update ? "set-1" : undefined,
							confirmedAt: update ? undefined : setTime,
							note: update ? "Imported note" : undefined,
						},
					],
				},
			],
		},
	}).pipe(Effect.orDie);
});

const page = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const run = (...args: Parameters<typeof definition.run>) => definition.run(...args);

const save = (...args: Parameters<typeof definition.run>) =>
	run(...args).pipe(Effect.map(({ output }) => output));

const rejected = (code: string) => ({
	_tag: "OperationRejectedError",
	reason: { key: `rejection.workout-save.${code}` },
});

const harness = (
	options: {
		pro?: boolean;
		current?: null;
		assetForbidden?: boolean;
		baseline?: WorkoutEditorBaseline;
		identities?: readonly WorkoutEditorEvent[];
		occurrences?: readonly WorkoutEditorEvent[];
		exercises?: readonly WorkoutEditorExercise[];
	} = {},
) => {
	const calls: { method: string; args: unknown[] }[] = [];
	const events = new Map<string, WorkoutEditorEvent>(
		(options.baseline?.sets ?? []).map((set) => [set.id, set]),
	);
	const rowsFor = (key: string): readonly unknown[] => {
		if (key === "scope") {
			return [{ revision: 7 }];
		}
		if (key === "entity") {
			return options.baseline && options.current !== null ? [options.baseline.entity] : [];
		}
		if (key === "exercises") {
			return (
				options.exercises ?? [
					{
						images: null,
						id: exerciseId,
						name: "Exercise",
						instructions: null,
						properties: { kind: "reps_and_weight" },
					},
				]
			);
		}
		if (key === "fitnessLibrary") {
			return [{ entityId: "library-1" }];
		}
		if (key === "sets") {
			return [...events.values()];
		}
		if (key === "occurrences") {
			if (options.occurrences !== undefined) {
				return options.occurrences;
			}
			return [
				...new Map(
					[...events.values()].map((set) => [set.properties["exerciseOrder"], set]),
				).values(),
			].map((set) => {
				const exerciseOrder = set.properties["exerciseOrder"];
				assert(typeof exerciseOrder === "number");
				return {
					occurredAt: time,
					entityId: set.entityId,
					id: `occurrence-${exerciseOrder}`,
					sessionEntityId: set.sessionEntityId,
					properties: {
						equipment: ["barbell"],
						exerciseKind: set.properties["exerciseKind"],
						exerciseOrder: set.properties["exerciseOrder"],
						targets: [{ role: "primary", entityId: "chest" }],
					},
				};
			});
		}
		if (key === "identities") {
			return (options.identities ?? [...events.values()]).map((set) =>
				Object.assign(
					{},
					{ id: set.id, entityId: set.entityId, sessionEntityId: set.sessionEntityId },
					{ slug: "workout-set" },
				),
			);
		}
		return [];
	};
	const host = defineSandboxTestHost(manifest, {
		getEntitlements: () => Effect.succeed(options.pro === true ? ["pro"] : []),
		executeRyotql: (document) =>
			Effect.succeed({
				data: Object.fromEntries(
					Object.keys(bindTestRequest(document).queries).map((key) => [key, page(rowsFor(key))]),
				),
			}),
		verifyManagedAssets: (assets) =>
			Effect.suspend(() => {
				calls.push({ args: [assets], method: "assets" });
				return options.assetForbidden
					? Effect.fail({ message: "Forbidden", data: { code: "asset-forbidden" } })
					: Effect.succeed(null);
			}),
	});
	return { host, calls };
};

describe("workout editor save", () => {
	it("rejects occurrence evidence that disagrees with its sets before committing", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const occurrence: WorkoutEditorEvent = {
					...original,
					id: EventId.make("occurrence-0"),
					properties: {
						targets: [],
						equipment: [],
						exerciseOrder: 0,
						exerciseKind: "reps_and_weight",
					},
				};
				const { host } = harness({
					baseline,
					occurrences: [{ ...occurrence, entityId: EntityId.make("different-exercise") }],
				});
				expect(yield* Effect.flip(save(yield* input(true), host))).toMatchObject(
					rejected("invalid-source"),
				);
			}),
		));

	it("fences evidence reads and retains the occurrence ID and snapshot when reordering", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = yield* input(true);
				assert(source.data.kind === "workout");
				const first = source.data.occurrences[0];
				assert(first);
				const { host } = harness({ baseline });
				const result = yield* run(
					{
						...source,
						data: {
							...source.data,
							occurrences: [
								{ ...first, sets: [], clientId: "empty", sourceExerciseOrder: undefined },
								first,
							],
						},
					},
					host,
				);
				expect(result.output).toEqual({});
				expect(result.changes).toEqual<unknown>(
					objectContaining({
						events: objectContaining({
							baselines: [objectContaining({ entityId, revision: 7 })],
							changes: arrayContaining([
								{
									kind: "update",
									itemIdentity: "update:occurrence-0",
									item: {
										eventId: "occurrence-0",
										patch: { properties: { remove: [], set: { exerciseOrder: 1 } } },
										expected: objectContaining({
											properties: {
												exerciseOrder: 0,
												equipment: ["barbell"],
												exerciseKind: "reps_and_weight",
												targets: [{ role: "primary", entityId: "chest" }],
											},
										}),
									},
								},
							]),
						}),
					}),
				);
			}),
		));
	it("swaps repeated exercises with distinct snapshots without rebinding retained sets", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = yield* input(true);
				assert(source.data.kind === "workout");
				const first = source.data.occurrences[0];
				assert(first);
				const second: WorkoutEditorEvent = {
					...original,
					id: EventId.make("set-2"),
					properties: { ...original.properties, exerciseOrder: 1 },
				};
				const repeated = { ...baseline, sets: [original, second] };
				const occurrences: WorkoutEditorEvent[] = [0, 1].map((exerciseOrder) => ({
					occurredAt: time,
					entityId: exerciseId,
					sessionEntityId: entityId,
					id: EventId.make(`anchor-${exerciseOrder}`),
					properties: {
						exerciseOrder,
						exerciseKind: "reps_and_weight",
						equipment: [`equipment-${exerciseOrder}`],
						targets: [{ role: "primary", entityId: `target-${exerciseOrder}` }],
					},
				}));
				const { host } = harness({ occurrences, baseline: repeated });
				const result = yield* run(
					{
						...source,
						data: {
							...source.data,
							target: {
								entityId,
								kind: "update",
								conflictToken: yield* Effect.fromResult(encodeWorkoutEditorBaseline(repeated)),
							},
							occurrences: [
								{
									...first,
									clientId: "second",
									sourceExerciseOrder: 1,
									sets: first.sets.map((set) => ({
										...set,
										eventId: second.id,
										clientId: "second-set",
									})),
								},
								first,
							],
						},
					},
					host,
				);
				expect(result.output).toEqual({});
				const command = result.changes;
				expect(command).toMatchObject({ events: { baselines: [{ entityId, revision: 7 }] } });
				for (const [oldOrder, eventId] of [original.id, second.id].entries()) {
					expect(command).toEqual<unknown>(
						objectContaining({
							events: objectContaining({
								changes: arrayContaining([
									{
										kind: "update",
										itemIdentity: `update:anchor-${oldOrder}`,
										item: {
											eventId: `anchor-${oldOrder}`,
											patch: { properties: { remove: [], set: { exerciseOrder: 1 - oldOrder } } },
											expected: objectContaining({
												sessionEntityId: entityId,
												properties: occurrences[oldOrder]?.properties,
											}),
										},
									},
									objectContaining({
										kind: "update",
										item: objectContaining({
											eventId,
											patch: objectContaining({
												properties: objectContaining({
													set: objectContaining({ exerciseOrder: 1 - oldOrder }),
												}),
											}),
										}),
									}),
								]),
							}),
						}),
					);
				}
			}),
		));

	it("replaces the last set atomically while retaining its occurrence anchor", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = yield* input(true);
				assert(source.data.kind === "workout");
				const { host } = harness({ baseline });
				const result = yield* run(
					{
						...source,
						data: {
							...source.data,
							occurrences: source.data.occurrences.map((occurrence) =>
								Object.assign({}, occurrence, {
									sets: occurrence.sets.map((set) =>
										Object.assign({}, set, {
											note: undefined,
											eventId: undefined,
											confirmedAt: setTime,
											clientId: "replacement",
										}),
									),
								}),
							),
						},
					},
					host,
				);
				expect(result.output).toEqual({});
				expect(result.changes).toEqual<unknown>(
					objectContaining({
						events: objectContaining({
							baselines: [objectContaining({ entityId, revision: 7 })],
							changes: [
								objectContaining({
									eventSchemaSlug: "workout-set",
									itemIdentity: "set:replacement",
									session: objectContaining({ kind: "root" }),
									properties: objectContaining({
										exerciseOrder: 0,
										exerciseKind: "reps_and_weight",
									}),
								}),
								objectContaining({ kind: "delete", eventId: original.id }),
							],
						}),
					}),
				);
			}),
		));

	it("returns the workout, sets, and completion as one change set, accepting zeros", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host, calls } = harness();
				const result = yield* run(yield* input(), host);
				expect(result.output).toEqual({});
				expect(calls).toEqual([]);
				expect(result.changes).toMatchObject({
					entity: {
						name: "Workout",
						target: { kind: "create" },
						entitySchemaSlug: "workout",
						properties: { startedAt: time },
					},
					events: {
						changes: [
							{
								kind: "create",
								eventSchemaSlug: "workout-exercise",
								itemIdentity: "occurrence:occurrence-1",
								properties: {
									targets: [],
									equipment: [],
									exerciseOrder: 0,
									exerciseKind: "reps_and_weight",
								},
							},
							{
								kind: "create",
								session: { kind: "root" },
								eventSchemaSlug: "workout-set",
								itemIdentity: "set:client-set-1",
								properties: { reps: 0, weight: 0 },
								entity: { kind: "existing", entityId: exerciseId },
							},
							{
								kind: "create",
								itemIdentity: "complete",
								entity: { kind: "root" },
								eventSchemaSlug: "workout-completed",
							},
						],
					},
				});
			}),
		));
	it("creates a workout with unconfirmed historical sets at their supplied time", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = yield* input();
				assert(source.data.kind === "workout");
				const { host } = harness();
				const result = yield* run(
					{
						...source,
						data: {
							...source.data,
							occurrences: source.data.occurrences.map((occurrence) =>
								Object.assign({}, occurrence, {
									sets: occurrence.sets.map((set) =>
										Object.assign({}, set, { confirmedAt: undefined }),
									),
								}),
							),
						},
					},
					host,
				);
				expect(result.output).toEqual({});
				expect(result.changes).toEqual<unknown>(
					objectContaining({
						events: objectContaining({
							changes: arrayContaining([
								objectContaining({
									kind: "create",
									occurredAt: setTime,
									itemIdentity: "set:client-set-1",
								}),
							]),
						}),
					}),
				);
			}),
		));
	it("verifies both media kinds attached to workout occurrences", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = yield* input();
				assert(source.data.kind === "workout");
				const image = { type: "s3", key: "new-exercise.jpg" } as const;
				const video = { type: "local", key: "permanent/new-exercise.mp4" } as const;
				const data = {
					...source.data,
					occurrences: source.data.occurrences.map((occurrence) => ({
						...occurrence,
						images: [image],
						videos: [video],
					})),
				};
				const { host, calls } = harness();
				expect(yield* save({ ...source, data }, host)).toMatchObject({});
				expect(calls.find(({ method }) => method === "assets")?.args[0]).toEqual([image, video]);
			}),
		));
	it("returns identical changes when the same submission runs again", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host } = harness();
				const submitted = yield* input();
				expect(yield* run(submitted, host)).toEqual(yield* run(submitted, host));
			}),
		));
	it("refuses a forbidden managed asset", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = yield* input();
				assert(source.data.kind === "workout");
				const { host } = harness({ pro: true, assetForbidden: true });
				expect(
					yield* Effect.flip(
						run(
							{ ...source, data: { ...source.data, images: [{ type: "s3", key: "other.jpg" }] } },
							host,
						),
					),
				).toMatchObject(rejected("media-forbidden"));
			}),
		));
	it("preserves imported notes, occurrence media, set times, and active duration on a free historical edit", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host, calls } = harness({ baseline });
				const result = yield* run(yield* input(true), host);
				expect(result.output).toEqual({});
				expect(result.changes).toMatchObject({
					events: {
						changes: [
							{
								kind: "update",
								itemIdentity: "update:set-1",
								item: {
									eventId: "set-1",
									expected: { kind: "fields", properties: { note: "Imported note" } },
									patch: { occurredAt: setTime, properties: { set: { note: "Imported note" } } },
								},
							},
						],
					},
					entity: {
						target: {
							kind: "update",
							expected: {
								name: baseline.entity.name,
								updatedAt: baseline.entity.updatedAt,
								properties: baseline.entity.properties,
							},
						},
						properties: {
							activeDuration: 3000,
							images: [{ type: "s3", key: "existing.jpg" }],
							exerciseMedia: [
								{ exerciseOrder: 0, images: occurrenceImages, videos: occurrenceVideos },
							],
						},
					},
				});
				expect(calls.some(({ method }) => method === "assets")).toBe(false);
				const unchanged = harness({ baseline });
				const unchangedSource = yield* input(true);
				assert(unchangedSource.data.kind === "workout");
				const unchangedInput = {
					...unchangedSource,
					data: {
						...unchangedSource.data,
						occurrences: unchangedSource.data.occurrences.map((occurrence) =>
							Object.assign({}, occurrence, {
								sets: occurrence.sets.map((set) =>
									Object.assign({}, set, { measurements: { reps: 10, weight: 50 } }),
								),
							}),
						),
					},
				};
				expect(yield* run(unchangedInput, unchanged.host)).toMatchObject({
					output: {},
					changes: { events: { changes: [] } },
				});
			}),
		));
	it("allows protected removals but rejects changed notes before any writes", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = yield* input(true);
				assert(source.data.kind === "workout");
				const data = {
					...source.data,
					images: [],
					occurrences: source.data.occurrences.map((occurrence) =>
						Object.assign({}, occurrence, {
							images: [],
							videos: [],
							sets: occurrence.sets.map((set) => ({ ...set, note: undefined })),
						}),
					),
				};
				const allowed = yield* run({ ...source, data }, harness({ baseline }).host);
				expect(allowed.output).toEqual({});
				expect(allowed.changes).toEqual<unknown>(
					objectContaining({
						events: objectContaining({
							changes: [
								objectContaining({
									kind: "update",
									item: objectContaining({
										eventId: "set-1",
										patch: objectContaining({
											properties: objectContaining({ remove: arrayContaining(["note"]) }),
										}),
									}),
								}),
							],
						}),
					}),
				);
				const removalData = {
					...data,
					occurrences: data.occurrences.map((occurrence) => ({ ...occurrence, sets: [] })),
				};
				expect(
					yield* run({ ...source, data: removalData }, harness({ baseline }).host),
				).toMatchObject({
					output: {},
					changes: {
						events: {
							changes: [
								{ kind: "delete", eventId: "occurrence-0", itemIdentity: "delete:occurrence-0" },
								{ kind: "delete", eventId: "set-1", itemIdentity: "delete:set-1" },
							],
						},
					},
				});
				const denied = harness({ baseline });
				const changed = {
					...data,
					occurrences: data.occurrences.map((occurrence) =>
						Object.assign({}, occurrence, {
							sets: occurrence.sets.map((set) => ({ ...set, note: "Changed" })),
						}),
					),
				};
				expect(yield* Effect.flip(save({ ...source, data: changed }, denied.host))).toEqual(
					new EntitlementRequiredError({ entitlement: "pro" }),
				);
				expect(denied.calls).toEqual([]);
			}),
		));
	it("leaves a workout another user cannot see to the commit's entity check", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host } = harness({ baseline, current: null, exercises: [] });
				expect(yield* run(yield* input(true), host)).toEqual({
					output: {},
					changes: {
						entity: {
							name: baseline.entity.name,
							entitySchemaSlug: "workout",
							properties: baseline.entity.properties,
							target: {
								kind: "update",
								entityId: baseline.entity.id,
								expected: {
									name: baseline.entity.name,
									updatedAt: baseline.entity.updatedAt,
									properties: baseline.entity.properties,
								},
							},
						},
					},
				});
			}),
		));
	it("leaves a kept set that vanished to the commit's baseline checks", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host } = harness({ baseline, identities: [] });
				expect(yield* run(yield* input(true), host)).toMatchObject({
					changes: {
						entity: { target: { kind: "update", entityId: baseline.entity.id } },
						events: {
							baselines: [{ entityId: baseline.entity.id }],
							expected: { eventIds: baseline.sets.map(({ id }) => id) },
						},
					},
				});
			}),
		));
	it("recaptures occurrence taxonomy and recreates kept sets at their original time when replacing with a same-kind exercise", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = yield* input(true);
				assert(source.data.kind === "workout");
				const replacementId = EntityId.make("exercise-2");
				const exercises = [
					{
						images: null,
						id: replacementId,
						instructions: null,
						name: "Replacement",
						properties: { kind: "reps_and_weight" },
					},
				];
				const submitted = {
					...source,
					data: {
						...source.data,
						occurrences: source.data.occurrences.map((occurrence) =>
							Object.assign({}, occurrence, { exerciseId: replacementId }),
						),
					},
				};
				const free = harness({ baseline, exercises });
				expect(yield* Effect.flip(save(submitted, free.host))).toEqual(
					new EntitlementRequiredError({ entitlement: "pro" }),
				);
				expect(free.calls).toEqual([]);
				const allowed = yield* run(submitted, harness({ baseline, exercises, pro: true }).host);
				expect(allowed.output).toEqual({});
				expect(allowed.changes).toMatchObject({
					events: {
						changes: [
							{
								kind: "create",
								eventSchemaSlug: "workout-exercise",
								itemIdentity: "occurrence:occurrence-1",
								entity: { kind: "existing", entityId: replacementId },
								properties: {
									targets: [],
									equipment: [],
									exerciseOrder: 0,
									exerciseKind: "reps_and_weight",
								},
							},
							{
								kind: "create",
								occurredAt: setTime,
								eventSchemaSlug: "workout-set",
								itemIdentity: "set:client-set-1",
								entity: { kind: "existing", entityId: replacementId },
							},
							{ kind: "delete", eventId: "occurrence-0", itemIdentity: "delete:occurrence-0" },
							{ kind: "delete", eventId: "set-1", itemIdentity: "delete:set-1" },
						],
					},
				});
				const wrongKind = harness({
					baseline,
					pro: true,
					exercises: [
						{
							...exercises[0],
							images: null,
							name: "Duration",
							id: replacementId,
							instructions: null,
							properties: { kind: "duration" },
						},
					],
				});
				expect(yield* Effect.flip(save(submitted, wrongKind.host))).toMatchObject(
					rejected("invalid-exercise-kind"),
				);
				expect(wrongKind.calls).toEqual([]);
			}),
		));
	it("saves exercise-only templates and partial plans, omitting rows that contain only a set type", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const submitted = yield* Schema.decodeEffect(WorkoutEditorSaveInputSchema)({
					submittedAt: time,
					submissionId: "template-1",
					data: {
						images: [],
						videos: [],
						name: "Plan",
						supersets: [],
						kind: "template",
						target: { kind: "create" },
						occurrences: [
							{
								notes: [],
								exerciseId,
								images: [],
								videos: [],
								clientId: "occurrence-1",
								sets: [
									{ setLot: "normal", clientId: "partial", measurements: { weight: 50 } },
									{ setLot: "drop", measurements: {}, clientId: "empty" },
									{ restTime: 0, clientId: "rest", setLot: "normal", measurements: {} },
								],
							},
							{
								sets: [],
								exerciseId,
								images: [],
								videos: [],
								clientId: "occurrence-2",
								notes: ["Exercise-only plan"],
							},
						],
					},
				});
				const free = harness();
				expect(yield* Effect.flip(save(submitted, free.host))).toEqual(
					new EntitlementRequiredError({ entitlement: "pro" }),
				);
				expect(free.calls).toEqual([]);
				const allowed = yield* run(submitted, harness({ pro: true }).host);
				expect(allowed.output).toEqual({});
				expect(allowed.changes).toMatchObject({
					events: { changes: [] },
					entity: {
						entitySchemaSlug: "workout-template",
						properties: {
							exercises: [
								{
									exerciseOrder: 0,
									sets: [
										{ weight: 50, setOrder: 0, setLot: "normal" },
										{ restTime: 0, setOrder: 1, setLot: "normal" },
									],
								},
								{ sets: [], exerciseOrder: 1, notes: ["Exercise-only plan"] },
							],
						},
					},
				});
			}),
		));
});
