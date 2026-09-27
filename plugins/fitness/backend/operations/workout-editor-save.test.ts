import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";
import { assert, describe, expect, it } from "vitest";

import { WorkoutEditorSaveInputSchema } from "../../shared/workout-editor-operations";
import {
	encodeWorkoutEditorBaseline,
	WorkoutEditorPropertiesSchema,
	type WorkoutEditorBaseline,
	type WorkoutEditorEvent,
	type WorkoutEditorExercise,
} from "../../shared/workout-editor-recipes";
import definition, { manifest } from "./workout-editor-save.sandbox";

const time = "2026-10-01T10:00:00.000Z";
const setTime = "2026-10-01T10:15:00.000Z";
const entityId = EntityId.make("workout-1");
const exerciseId = EntityId.make("exercise-1");
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
					sourceExerciseOrder: update ? 0 : undefined,
					sets: [
						{
							images: [],
							videos: [],
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
		baseline?: WorkoutEditorBaseline;
		exercises?: readonly WorkoutEditorExercise[];
	} = {},
) => {
	const calls: { method: string; args: unknown[] }[] = [];
	const events = new Map<string, WorkoutEditorEvent>(
		(options.baseline?.sets ?? []).map((set) => [set.id, set]),
	);
	let partial = options.partial ?? false;
	const rowsFor = (key: string): readonly unknown[] => {
		if (key === "entity") {
			return options.baseline === undefined ? [] : [options.baseline.entity];
		}
		if (key === "exercises") {
			return (
				options.exercises ?? [
					{ id: exerciseId, name: "Exercise", properties: { kind: "reps_and_weight" } },
				]
			);
		}
		if (key === "fitnessLibrary") {
			return [{ entityId: "library-1" }];
		}
		if (key === "sets") {
			return [...events.values()];
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
		createUserEntity: (...args) =>
			Effect.sync(() => {
				calls.push({ args, method: "createEntity" });
				return { entityId };
			}),
		updateUserEntity: (...args) =>
			Effect.sync(() => {
				calls.push({ args, method: "updateEntity" });
				return { entityId };
			}),
		updateEvents: (...args) =>
			Effect.sync(() => {
				calls.push({ args, method: "updateSets" });
				return { count: args[0].length };
			}),
		changeUserRelationships: (...args) =>
			Effect.sync(() => {
				calls.push({ args, method: "relationships" });
				return [{ created: 1, deleted: 0 }];
			}),
		executeRyotql: (document) =>
			Effect.succeed({
				data: Object.fromEntries(
					Object.keys(document.queries).map((key) => [key, page(rowsFor(key))]),
				),
			}),
		deleteEvents: (...args) =>
			Effect.sync(() => {
				calls.push({ args, method: "deleteSets" });
				for (const id of args[0]) {
					events.delete(id);
				}
				return { count: args[0].length };
			}),
		createEvents: (items, identity) =>
			Effect.suspend(() => {
				calls.push({
					args: [items, identity],
					method: items[0]?.eventSchemaSlug === "workout-completed" ? "finalize" : "createSets",
				});
				if (partial) {
					partial = false;
					return Effect.fail({
						message: "Interrupted",
						data: { count: 0, outcomes: [], partial: true },
					});
				}
				return Effect.succeed({
					count: items.length,
					outcomes: items.map((item, index) => {
						const id = EventId.make(`new-set-${index}`);
						if (item.eventSchemaSlug === "workout-set") {
							events.set(id, {
								id,
								entityId: exerciseId,
								sessionEntityId: entityId,
								occurredAt: item.occurredAt ?? time,
								properties: Schema.decodeUnknownSync(WorkoutEditorPropertiesSchema)(
									item.properties,
								),
							});
						}
						return { index, eventId: id, status: "written" as const };
					}),
				});
			}),
	});
	return { host, calls };
};

describe("workout editor save", () => {
	it("writes the workout before sets and finalizes only after a complete save, accepting zeros", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host, calls } = harness();
				const result = yield* definition.run(input(), host);
				expect(result).toMatchObject({
					entityId,
					kind: "saved",
					sets: [{ eventId: "new-set-0", clientId: "client-set-1" }],
				});
				expect(calls.map(({ method }) => method)).toEqual([
					"createEntity",
					"relationships",
					"createSets",
					"finalize",
				]);
				expect(calls.find(({ method }) => method === "createSets")?.args[0]).toMatchObject([
					{ sessionEntityId: entityId, properties: { reps: 0, weight: 0 } },
				]);
			}),
		));
	it("keeps immutable write arguments on retry and does not finalize an incomplete save", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host, calls } = harness({ partial: true });
				const submitted = input();
				expect(yield* definition.run(submitted, host)).toEqual({
					entityId,
					kind: "incomplete",
					committedSetIds: [],
				});
				expect(calls.some(({ method }) => method === "finalize")).toBe(false);
				expect(yield* definition.run(submitted, host)).toMatchObject({ kind: "saved" });
				const writes = calls.filter(({ method }) => method === "createSets");
				expect(writes[0]?.args).toEqual(writes[1]?.args);
			}),
		));
	it("preserves imported notes, media, set times, and active duration on a free historical edit", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host, calls } = harness({ baseline });
				expect(yield* definition.run(input(true), host)).toMatchObject({ kind: "saved" });
				expect(calls.find(({ method }) => method === "updateEntity")?.args[0]).toMatchObject({
					properties: { activeDuration: 3000, images: [{ type: "s3", key: "existing.jpg" }] },
					expected: {
						name: baseline.entity.name,
						updatedAt: baseline.entity.updatedAt,
						properties: baseline.entity.properties,
					},
				});
				expect(calls.find(({ method }) => method === "updateSets")?.args[0]).toMatchObject([
					{
						eventId: "set-1",
						expected: { kind: "fields", properties: { note: "Imported note" } },
						patch: { occurredAt: setTime, properties: { set: { note: "Imported note" } } },
					},
				]);
				expect(calls.some(({ method }) => method === "finalize" || method === "assets")).toBe(
					false,
				);
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
							sets: occurrence.sets.map((set) => ({ ...set, note: undefined })),
						}),
					),
				};
				const allowed = harness({ baseline });
				expect(yield* definition.run({ ...source, data }, allowed.host)).toMatchObject({
					kind: "saved",
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
				const fixture = harness();
				const host: ScriptHost = {
					...fixture.host,
					createUserEntity: () =>
						Effect.fail({
							message: "Not a business contract",
							data: { code: "mutation-conflict" },
						}),
				};
				expect(yield* definition.run(input(), host)).toEqual({ kind: "conflict" });
			}),
		));
	it("retains historical set identity and completion when replacing with a same-kind exercise", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const source = input(true);
				assert(source.data.kind === "workout");
				const replacementId = EntityId.make("exercise-2");
				const exercises = [
					{ id: replacementId, name: "Replacement", properties: { kind: "reps_and_weight" } },
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
				expect(allowed.calls.find(({ method }) => method === "updateSets")?.args[0]).toMatchObject([
					{ eventId: "set-1", patch: { occurredAt: setTime, entityId: replacementId } },
				]);
				const wrongKind = harness({
					baseline,
					pro: true,
					exercises: [
						{
							...exercises[0],
							name: "Duration",
							id: replacementId,
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
				expect(allowed.calls.map(({ method }) => method)).toEqual(["createEntity"]);
				expect(allowed.calls[0]?.args[0]).toMatchObject({
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
				});
			}),
		));
});
