import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";
import { assert, describe, expect, it } from "vitest";

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

const input = (update = false) =>
	Schema.decodeUnknownSync(WorkoutEditorSaveInputSchema)({
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
				? { entityId, kind: "update", conflictToken: encodeWorkoutEditorBaseline(baseline) }
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
	});

const page = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const harness = (
	options: {
		pro?: boolean;
		partial?: boolean;
		lateConflict?: boolean;
		baseline?: WorkoutEditorBaseline;
		occurrences?: readonly WorkoutEditorEvent[];
		exercises?: readonly WorkoutEditorExercise[];
	} = {},
) => {
	const calls: { method: string; args: unknown[] }[] = [];
	const events = new Map<string, WorkoutEditorEvent>(
		(options.baseline?.sets ?? []).map((set) => [set.id, set]),
	);
	let partial = options.partial ?? false;
	const rowsFor = (key: string): readonly unknown[] => {
		if (key === "scope") {
			return [{ revision: 7 }];
		}
		if (key === "entity") {
			return options.baseline === undefined ? [] : [options.baseline.entity];
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
						provenance: "legacy",
						equipment: ["barbell"],
						exerciseKind: set.properties["exerciseKind"],
						exerciseOrder: set.properties["exerciseOrder"],
						targets: [{ role: "primary", entityId: "chest" }],
					},
				};
			});
		}
		if (key === "identities") {
			return [...events.values()].map((set) =>
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
		getProAvailability: () => Effect.succeed(options.pro ?? false),
		verifyManagedAssets: (assets) =>
			Effect.sync(() => {
				calls.push({ args: [assets], method: "assets" });
				return null;
			}),
		executeRyotql: (document) =>
			Effect.succeed({
				data: Object.fromEntries(
					Object.keys(document.queries).map((key) => [key, page(rowsFor(key))]),
				),
			}),
		commitUserChanges: (command, submission) =>
			Effect.suspend(() => {
				calls.push({ method: "commit", args: [command, submission] });
				if (partial) {
					partial = false;
					return Effect.fail({ message: "Interrupted" });
				}
				if (options.lateConflict) {
					return Effect.fail({
						data: { code: "entity-stale" },
						message: "Not a business contract",
					});
				}
				return Effect.succeed({
					entityId,
					events: command.events.creates.map((item, index) => ({
						itemIdentity: item.itemIdentity,
						eventId: EventId.make(`new-set-${index}`),
					})),
				});
			}),
	});
	return { host, calls };
};

describe("workout editor save", () => {
	it("rejects ambiguous or mismatched occurrence evidence before committing", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const occurrence: WorkoutEditorEvent = {
					...original,
					id: EventId.make("occurrence-0"),
					properties: {
						targets: [],
						equipment: [],
						exerciseOrder: 0,
						provenance: "legacy",
						exerciseKind: "reps_and_weight",
					},
				};
				for (const occurrences of [
					[occurrence, { ...occurrence, id: EventId.make("duplicate") }],
					[{ ...occurrence, entityId: EntityId.make("different-exercise") }],
				]) {
					const { host, calls } = harness({ baseline, occurrences });
					expect(yield* definition.run(input(true), host)).toMatchObject({
						kind: "invalid",
						code: "invalid-source",
					});
					expect(calls.filter(({ method }) => method === "commit")).toEqual([]);
				}
			}),
		));

	it("fences evidence reads and retains the occurrence ID and snapshot when reordering", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = input(true);
				assert(source.data.kind === "workout");
				const first = source.data.occurrences[0];
				assert(first);
				const { host, calls } = harness({ baseline });
				const result = yield* definition.run(
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
				expect(result.kind).toBe("saved");
				expect(calls.find(({ method }) => method === "commit")?.args[0]).toMatchObject({
					events: {
						baselines: [{ entityId, revision: 7 }],
						changes: expect.arrayContaining([
							{
								kind: "update",
								itemIdentity: "occurrence-update:occurrence-0",
								item: {
									eventId: "occurrence-0",
									patch: {
										entityId: exerciseId,
										properties: { remove: [], set: { exerciseOrder: 1 } },
									},
									expected: expect.objectContaining({
										properties: {
											exerciseOrder: 0,
											provenance: "legacy",
											equipment: ["barbell"],
											exerciseKind: "reps_and_weight",
											targets: [{ role: "primary", entityId: "chest" }],
										},
									}),
								},
							},
						]),
					},
				});
			}),
		));
	it("swaps repeated exercises with distinct snapshots without rebinding retained sets", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = input(true);
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
						provenance: "legacy",
						exerciseKind: "reps_and_weight",
						equipment: [`equipment-${exerciseOrder}`],
						targets: [{ role: "primary", entityId: `target-${exerciseOrder}` }],
					},
				}));
				const { host, calls } = harness({ occurrences, baseline: repeated });
				expect(
					yield* definition.run(
						{
							...source,
							data: {
								...source.data,
								target: {
									entityId,
									kind: "update",
									conflictToken: encodeWorkoutEditorBaseline(repeated),
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
					),
				).toMatchObject({ kind: "saved" });
				const command = calls.find(({ method }) => method === "commit")?.args[0];
				expect(command).toMatchObject({
					events: { creates: [], baselines: [{ entityId, revision: 7 }] },
				});
				for (const [oldOrder, eventId] of [original.id, second.id].entries()) {
					expect(command).toMatchObject({
						events: {
							changes: expect.arrayContaining([
								{
									kind: "update",
									itemIdentity: `occurrence-update:anchor-${oldOrder}`,
									item: {
										eventId: `anchor-${oldOrder}`,
										patch: {
											entityId: exerciseId,
											properties: { remove: [], set: { exerciseOrder: 1 - oldOrder } },
										},
										expected: expect.objectContaining({
											sessionEntityId: entityId,
											properties: occurrences[oldOrder]?.properties,
										}),
									},
								},
								expect.objectContaining({
									kind: "update",
									item: expect.objectContaining({
										eventId,
										patch: expect.objectContaining({
											properties: expect.objectContaining({
												set: expect.objectContaining({ exerciseOrder: 1 - oldOrder }),
											}),
										}),
									}),
								}),
							]),
						},
					});
				}
			}),
		));

	it("replaces the last set atomically while retaining its occurrence anchor", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = input(true);
				assert(source.data.kind === "workout");
				const { host, calls } = harness({ baseline });
				expect(
					yield* definition.run(
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
					),
				).toMatchObject({ kind: "saved" });
				expect(calls.find(({ method }) => method === "commit")?.args[0]).toMatchObject({
					events: {
						baselines: [{ entityId, revision: 7 }],
						changes: [expect.objectContaining({ kind: "delete", eventId: original.id })],
						creates: [
							{
								session: { kind: "root" },
								eventSchemaSlug: "workout-set",
								itemIdentity: "set:replacement",
								properties: { exerciseOrder: 0, exerciseKind: "reps_and_weight" },
							},
						],
					},
				});
			}),
		));

	it("commits the workout, sets, and completion atomically, accepting zeros", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host, calls } = harness();
				const result = yield* definition.run(input(), host);
				expect(result).toMatchObject({
					entityId,
					kind: "saved",
					sets: [{ eventId: "new-set-1", clientId: "client-set-1" }],
				});
				expect(calls.map(({ method }) => method)).toEqual(["commit"]);
				const command = calls[0]?.args[0];
				expect(command).toMatchObject({
					entity: {
						name: "Workout",
						target: { kind: "create" },
						entitySchemaSlug: "workout",
						properties: { startedAt: time },
					},
					events: {
						creates: [
							{
								eventSchemaSlug: "workout-exercise",
								itemIdentity: "occurrence:occurrence-1",
								properties: {
									targets: [],
									equipment: [],
									exerciseOrder: 0,
									provenance: "recorded",
									exerciseKind: "reps_and_weight",
								},
							},
							{
								session: { kind: "root" },
								eventSchemaSlug: "workout-set",
								itemIdentity: "set:client-set-1",
								properties: { reps: 0, weight: 0 },
								entity: { kind: "existing", entityId: exerciseId },
							},
							{
								itemIdentity: "complete",
								entity: { kind: "root" },
								eventSchemaSlug: "workout-completed",
							},
						],
					},
				});
				expect(calls[0]?.args[1]).toEqual({
					submittedAt: input().submittedAt,
					idempotencyKey: "submission-1:save",
				});
			}),
		));
	it("verifies both media kinds attached to workout occurrences", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = input();
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
				expect(yield* definition.run({ ...source, data }, host)).toMatchObject({ kind: "saved" });
				expect(calls.find(({ method }) => method === "assets")?.args[0]).toEqual([image, video]);
			}),
		));
	it("retries an atomic commit with identical arguments after a failed Effect", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host, calls } = harness({ partial: true });
				const submitted = input();
				expect(yield* Effect.result(definition.run(submitted, host))).toMatchObject({
					_tag: "Failure",
				});
				expect(yield* definition.run(submitted, host)).toMatchObject({ kind: "saved" });
				const commits = calls.filter(({ method }) => method === "commit");
				expect(commits).toHaveLength(2);
				expect(commits[0]?.args).toEqual(commits[1]?.args);
				expect(commits[0]?.args[1]).toEqual({
					submittedAt: submitted.submittedAt,
					idempotencyKey: "submission-1:save",
				});
			}),
		));
	it("preserves imported notes, occurrence media, set times, and active duration on a free historical edit", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host, calls } = harness({ baseline });
				expect(yield* definition.run(input(true), host)).toMatchObject({ kind: "saved" });
				const commit = calls.find(({ method }) => method === "commit");
				expect(commit?.args[0]).toMatchObject({
					events: {
						creates: [],
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
				const unchangedSource = input(true);
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
				expect(yield* definition.run(unchangedInput, unchanged.host)).toMatchObject({
					kind: "saved",
				});
				expect(unchanged.calls.find(({ method }) => method === "commit")?.args[0]).toMatchObject({
					events: { changes: [] },
				});
			}),
		));
	it("allows protected removals but rejects changed notes before any writes", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = input(true);
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
				const allowed = harness({ baseline });
				expect(yield* definition.run({ ...source, data }, allowed.host)).toMatchObject({
					kind: "saved",
				});
				expect(allowed.calls.find(({ method }) => method === "commit")?.args[0]).toMatchObject({
					events: {
						changes: [
							{
								kind: "update",
								item: {
									eventId: "set-1",
									patch: { properties: { remove: expect.arrayContaining(["note"]) } },
								},
							},
						],
					},
				});
				const removedSet = harness({ baseline });
				const removalData = {
					...data,
					occurrences: data.occurrences.map((occurrence) => ({ ...occurrence, sets: [] })),
				};
				expect(
					yield* definition.run({ ...source, data: removalData }, removedSet.host),
				).toMatchObject({ kind: "saved" });
				expect(removedSet.calls.find(({ method }) => method === "commit")?.args[0]).toMatchObject({
					events: {
						changes: [
							{
								kind: "delete",
								eventId: "occurrence-0",
								itemIdentity: "occurrence-delete:occurrence-0",
							},
							{ kind: "delete", eventId: "set-1", itemIdentity: "delete:set-1" },
						],
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
				expect(yield* definition.run({ ...source, data: changed }, denied.host)).toEqual({
					kind: "pro-required",
				});
				expect(denied.calls).toEqual([]);
			}),
		));
	it("returns typed conflicts rather than parsing diagnostic text", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				for (const code of ["entity-stale", "mutation-conflict"]) {
					const fixture = harness();
					const host: ScriptHost = {
						...fixture.host,
						commitUserChanges: () =>
							Effect.fail({ data: { code }, message: "Not a business contract" }),
					};
					expect(yield* definition.run(input(), host)).toEqual({ kind: "conflict" });
				}
			}),
		));
	it("reports atomic commit conflicts without partial results", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host, calls } = harness({ lateConflict: true });
				expect(yield* definition.run(input(), host)).toEqual({ kind: "conflict" });
				expect(calls.map(({ method }) => method)).toEqual(["commit"]);
			}),
		));
	it("retains historical set identity and completion when replacing with a same-kind exercise", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = input(true);
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
				expect(yield* definition.run(submitted, free.host)).toEqual({ kind: "pro-required" });
				expect(free.calls).toEqual([]);
				const allowed = harness({ baseline, exercises, pro: true });
				expect(yield* definition.run(submitted, allowed.host)).toMatchObject({
					kind: "saved",
					sets: [{ eventId: "set-1", clientId: "client-set-1" }],
				});
				expect(allowed.calls.find(({ method }) => method === "commit")?.args[0]).toMatchObject({
					events: {
						changes: [
							{
								kind: "update",
								item: {
									eventId: "occurrence-0",
									patch: {
										entityId: replacementId,
										properties: { remove: [], set: { exerciseOrder: 0 } },
									},
								},
							},
							{
								kind: "update",
								item: { eventId: "set-1", patch: { occurredAt: setTime, entityId: replacementId } },
							},
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
				expect(yield* definition.run(submitted, wrongKind.host)).toEqual({
					kind: "invalid",
					code: "invalid-exercise-kind",
				});
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
				expect(yield* definition.run(submitted, free.host)).toEqual({ kind: "pro-required" });
				expect(free.calls).toEqual([]);
				const allowed = harness({ pro: true });
				expect(yield* definition.run(submitted, allowed.host)).toEqual({
					entityId,
					sets: [],
					kind: "saved",
				});
				expect(allowed.calls.map(({ method }) => method)).toEqual(["commit"]);
				expect(allowed.calls[0]?.args[0]).toMatchObject({
					events: { creates: [], changes: [] },
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
