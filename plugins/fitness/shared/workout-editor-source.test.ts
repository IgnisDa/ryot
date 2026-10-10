import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";
import { assert, expect, it } from "vitest";

import { WorkoutEditorDraftSchema } from "./workout-editor-draft";
import {
	WorkoutEditorBaselineSchema,
	WorkoutEditorPropertiesSchema,
	type WorkoutEditorExercise,
} from "./workout-editor-recipes";
import { cloneWorkoutEditorSource, hydrateWorkoutEditorSource } from "./workout-editor-source";

const startedAt = "2026-10-15T10:00:00.000Z";
const confirmedAt = "2026-10-15T10:10:00.000Z";
const restTimerStartedAt = "2026-10-15T10:10:05.000Z";

const entityId = (value: string) => Schema.decodeSync(EntityId)(value);
const eventId = (value: string) => Schema.decodeSync(EventId)(value);

const exercise = (id: string, kind = "reps_and_weight"): WorkoutEditorExercise => ({
	id: entityId(id),
	name: `Exercise ${id}`,
	properties: Schema.decodeSync(WorkoutEditorPropertiesSchema)({ kind }),
});

const event = (id: string, exerciseId: string, properties: Record<string, unknown> = {}) => ({
	id: eventId(id),
	occurredAt: startedAt,
	entityId: entityId(exerciseId),
	sessionEntityId: entityId("workout-1"),
	properties: Schema.decodeSync(WorkoutEditorPropertiesSchema)({
		reps: 5,
		setOrder: 0,
		weight: 100,
		exerciseOrder: 0,
		setLot: "normal",
		exerciseKind: "reps_and_weight",
		...properties,
	}),
});

const baseline = (
	properties: Record<string, unknown> = {},
	sets: ReturnType<typeof event>[] = [],
) =>
	Schema.decodeSync(WorkoutEditorBaselineSchema)({
		sets,
		entity: {
			updatedAt: startedAt,
			name: "Source workout",
			id: entityId("workout-1"),
			properties: Schema.decodeUnknownSync(WorkoutEditorPropertiesSchema)({ ...properties }),
		},
	});

const workoutProperties = (properties: Record<string, unknown> = {}) => ({
	startedAt,
	...properties,
});

it("hydrates saved sets without confirmations and retains their recorded exercise kind", () => {
	const source = baseline(workoutProperties({ caloriesBurnt: 0, activeDuration: 0 }), [
		event("set-1", "exercise-1", { confirmedAt: null, exerciseKind: "reps_and_weight" }),
	]);
	const result = hydrateWorkoutEditorSource({
		kind: "workout",
		baseline: source,
		draftId: "draft-1",
		exercises: [exercise("exercise-1", "duration")],
	});

	assert(result.kind === "ready");
	expect(result.draft.mode).toMatchObject({
		kind: "historical",
		conflictToken: expect.any(String),
	});
	expect(result.draft.activeDurationIntent).toBe("preserve");
	expect(result.draft.activeDuration).toBe(0);
	expect(result.draft.caloriesBurnt).toBe("0");
	expect(result.draft.occurrences[0]?.exerciseKind).toBe("reps_and_weight");
	expect(result.draft.occurrences[0]?.sets[0]).toMatchObject({
		reps: "5",
		weight: "100",
		included: true,
		eventId: "set-1",
		clientId: "set-1",
		confirmedAt: undefined,
		exerciseKind: "reps_and_weight",
	});
});

it("includes a saved set without the optional set type as a normal set", () => {
	const set = event("set-1", "exercise-1");
	const source = baseline(workoutProperties(), [
		{
			...set,
			properties: Object.fromEntries(
				Object.entries(set.properties).filter(([key]) => key !== "setLot"),
			),
		},
	]);
	const result = hydrateWorkoutEditorSource({
		kind: "workout",
		baseline: source,
		draftId: "draft-1",
		exercises: [exercise("exercise-1")],
	});
	assert(result.kind === "ready");
	expect(result.draft.occurrences[0]?.sets[0]).toMatchObject({
		included: true,
		setLot: "normal",
		eventId: "set-1",
		occurredAt: startedAt,
	});
});

it("retains the baseline rather than silently dropping orphaned or ambiguous occurrence media", () => {
	for (const exerciseMedia of [
		[{ videos: [], exerciseOrder: 2, images: [{ type: "local", key: "permanent/orphan.jpg" }] }],
		[
			{ images: [], videos: [], exerciseOrder: 0 },
			{ videos: [], exerciseOrder: 0, images: [{ type: "local", key: "permanent/duplicate.jpg" }] },
		],
	]) {
		const source = baseline(workoutProperties({ exerciseMedia }), [event("set-1", "exercise-1")]);
		const result = hydrateWorkoutEditorSource({
			kind: "workout",
			baseline: source,
			draftId: "draft-1",
			exercises: [exercise("exercise-1")],
		});
		assert(result.kind === "blocked");
		expect(result.baseline).toEqual(source);
		expect(result.blockers).toEqual([{ code: "invalid-record", exerciseId: "workout-1" }]);
	}
});

it("orders repeated exercise occurrences, sets, notes, and superset members by source position", () => {
	const source = baseline(
		workoutProperties({
			caloriesBurnt: 0,
			activeDuration: 600,
			endedAt: confirmedAt,
			comment: "Session reflection",
			supersets: [{ color: "blue", exercises: [1, 4] }],
			images: [{ type: "s3", key: "workout/cover.jpg" }],
			videos: [{ type: "s3", key: "workout/video.mp4" }],
			exerciseNotes: [
				{ exerciseOrder: 4, notes: ["Later occurrence"] },
				{ exerciseOrder: 1, notes: ["First occurrence"] },
			],
			exerciseMedia: [
				{
					exerciseOrder: 4,
					images: [{ type: "s3", key: "occurrence/four-image.jpg" }],
					videos: [{ type: "s3", key: "occurrence/four-video.mp4" }],
				},
				{
					exerciseOrder: 1,
					images: [{ type: "local", key: "permanent/occurrence-one.jpg" }],
					videos: [{ type: "remote", url: "https://example.com/occurrence-one.mp4" }],
				},
			],
		}),
		[
			event("event-z", "exercise-1", {
				rpe: 8,
				setOrder: 2,
				confirmedAt,
				restTime: 0,
				exerciseOrder: 4,
				note: "Set note",
				restTimerStartedAt,
			}),
			event("event-b", "exercise-1", { setOrder: 0, exerciseOrder: 1 }),
			event("event-a", "exercise-1", { setOrder: 2, exerciseOrder: 4 }),
		],
	);
	const result = hydrateWorkoutEditorSource({
		kind: "workout",
		baseline: source,
		draftId: "draft-1",
		exercises: [exercise("exercise-1")],
	});

	assert(result.kind === "ready");
	expect(
		result.draft.occurrences.map(({ notes, sourceExerciseOrder }) => [sourceExerciseOrder, notes]),
	).toEqual([
		[1, ["First occurrence"]],
		[4, ["Later occurrence"]],
	]);
	expect(result.draft.occurrences[0]).toMatchObject({
		images: [{ type: "local", key: "permanent/occurrence-one.jpg" }],
		videos: [{ type: "remote", url: "https://example.com/occurrence-one.mp4" }],
	});
	expect(result.draft.occurrences[1]).toMatchObject({
		images: [{ type: "s3", key: "occurrence/four-image.jpg" }],
		videos: [{ type: "s3", key: "occurrence/four-video.mp4" }],
	});
	expect(result.draft.occurrences[1]?.clientId).toContain(":4");
	expect(result.draft.occurrences[1]?.sets.map(({ clientId }) => clientId)).toEqual([
		"event-a",
		"event-z",
	]);
	expect(result.draft).toMatchObject({
		startedAt,
		caloriesBurnt: "0",
		activeDuration: 600,
		endedAt: confirmedAt,
		displayEnergyUnit: "kcal",
		comment: "Session reflection",
		images: [{ type: "s3", key: "workout/cover.jpg" }],
		videos: [{ type: "s3", key: "workout/video.mp4" }],
	});
	expect(result.draft.occurrences[1]?.sets[1]).toMatchObject({
		rpe: "8",
		confirmedAt,
		setLot: "normal",
		note: "Set note",
		restTimerStartedAt,
		restChoice: { seconds: "0", kind: "explicit" },
	});
	expect(result.draft.supersets[0]?.occurrenceIds).toEqual(
		result.draft.occurrences.map(({ clientId }) => clientId),
	);
});

it("maps sparse source exercise orders in superset groups", () => {
	const source = baseline(
		workoutProperties({ supersets: [{ color: "violet", exercises: [2, 7] }] }),
		[
			event("set-7", "exercise-2", { exerciseOrder: 7 }),
			event("set-2", "exercise-1", { exerciseOrder: 2 }),
		],
	);
	const result = hydrateWorkoutEditorSource({
		kind: "workout",
		baseline: source,
		draftId: "draft-sparse",
		exercises: [exercise("exercise-1"), exercise("exercise-2")],
	});

	assert(result.kind === "ready");
	expect(result.draft.occurrences.map(({ sourceExerciseOrder }) => sourceExerciseOrder)).toEqual([
		2, 7,
	]);
	expect(result.draft.supersets[0]?.occurrenceIds).toEqual(
		result.draft.occurrences.map(({ clientId }) => clientId),
	);
});

it("hydrates empty template exercises and partial planned sets", () => {
	const source = baseline({
		exercises: [
			{
				images: null,
				exerciseOrder: 1,
				exerciseId: "exercise-1",
				notes: ["Keep this cue"],
				sets: [{ weight: 0, reps: null, setOrder: 0, restTime: null, setLot: "normal" }],
			},
			{ sets: [], notes: [], exerciseOrder: 3, exerciseId: "exercise-2" },
		],
	});
	const result = hydrateWorkoutEditorSource({
		baseline: source,
		kind: "template",
		draftId: "draft-template",
		exercises: [exercise("exercise-1", "duration"), exercise("exercise-2", "reps")],
	});

	assert(result.kind === "ready");
	expect(result.draft.mode).toMatchObject({ kind: "template-edit", entityId: "workout-1" });
	expect(result.draft.occurrences[0]?.display).toEqual({
		weightUnit: "kg",
		distanceUnit: "km",
		durationUnit: "seconds",
	});
	expect(result.draft.occurrences).toHaveLength(2);
	expect(result.draft.occurrences[0]).toMatchObject({
		sourceExerciseOrder: 1,
		exerciseKind: "duration",
		notes: ["Keep this cue"],
	});
	expect(result.draft.occurrences[0]?.sets[0]).toMatchObject({
		weight: "0",
		included: false,
		reps: undefined,
		exerciseKind: "duration",
		restChoice: { kind: "inherited" },
	});
	expect(result.draft.occurrences[0]?.sets[0]?.eventId).toBeUndefined();
	expect(result.draft.occurrences[0]?.sets[0]?.occurredAt).toBeUndefined();
	expect(result.draft.occurrences[0]?.sets[0]?.confirmedAt).toBeUndefined();
	expect(result.draft.occurrences[1]?.sets).toEqual([]);
	expect(result.draft.occurrences[0]?.images).toEqual([]);
	expect(result.draft.occurrences[0]?.videos).toEqual([]);
});

it("blocks missing source exercises and retains the baseline for recovery", () => {
	const source = baseline(workoutProperties(), [event("set-1", "missing-exercise")]);
	const result = hydrateWorkoutEditorSource({
		exercises: [],
		kind: "workout",
		baseline: source,
		draftId: "draft-1",
	});

	assert(result.kind === "blocked");
	expect(result.baseline).toBe(source);
	expect(result.blockers).toEqual([{ code: "missing-exercise", exerciseId: "missing-exercise" }]);
});

it("blocks malformed embedded template records instead of dropping them", () => {
	const source = baseline({
		exercises: [
			{
				notes: [],
				images: [],
				videos: [],
				exerciseOrder: 0,
				exerciseId: "exercise-1",
				sets: [{ setOrder: 0, setLot: "unknown" }],
			},
		],
	});
	const result = hydrateWorkoutEditorSource({
		kind: "template",
		baseline: source,
		draftId: "draft-template",
		exercises: [exercise("exercise-1")],
	});

	assert(result.kind === "blocked");
	expect(result.baseline).toBe(source);
	expect(result.blockers).toEqual([{ code: "invalid-record", exerciseId: "workout-1" }]);
});

it("clones source drafts with injected identities and clears session-only data", () => {
	const source = baseline(
		workoutProperties({
			caloriesBurnt: 321,
			comment: "Reflection",
			supersets: [{ color: "green", exercises: [0, 1] }],
			images: [{ type: "s3", key: "workout/image.jpg" }],
			exerciseMedia: [
				{
					exerciseOrder: 0,
					videos: [{ type: "s3", key: "occurrence/video.mp4" }],
					images: [{ type: "local", key: "permanent/occurrence-image.jpg" }],
				},
			],
		}),
		[
			event("set-1", "exercise-1", {
				rpe: 8,
				confirmedAt,
				restTime: 90,
				note: "Set note",
				restTimerStartedAt,
			}),
			event("set-2", "exercise-1", { exerciseOrder: 1 }),
		],
	);
	const hydrated = hydrateWorkoutEditorSource({
		kind: "workout",
		baseline: source,
		draftId: "draft-source",
		exercises: [exercise("exercise-1")],
	});
	assert(hydrated.kind === "ready");
	const nextId = (() => {
		let count = 0;
		return () => `fresh-${(count += 1)}`;
	})();
	const live = cloneWorkoutEditorSource(hydrated.draft, {
		kind: "live",
		idFor: nextId,
		draftId: "draft-live",
		name: "Repeated workout",
		templateId: entityId("template-1"),
		startedAt: "2026-10-16T10:00:00.000Z",
	});

	expect(live.mode).toEqual({ kind: "live", source: { kind: "template", entityId: "template-1" } });
	expect(live).toMatchObject({
		images: [],
		activeDuration: 0,
		comment: undefined,
		caloriesBurnt: undefined,
		activeDurationIntent: "set",
		activeDurationStartedAt: "2026-10-16T10:00:00.000Z",
	});
	expect(live.occurrences[0]?.sourceExerciseOrder).toBeUndefined();
	expect(live.occurrences[0]).toMatchObject({ images: [], videos: [] });
	expect(live.occurrences[0]?.sets[0]).toMatchObject({
		rpe: "8",
		included: false,
		note: "Set note",
		eventId: undefined,
		occurredAt: undefined,
		confirmedAt: undefined,
		restTimerStartedAt: undefined,
	});
	expect(live.occurrences[0]?.sets[0]?.clientId).not.toBe("set-1");
	expect(live.supersets[0]?.occurrenceIds).toEqual(
		live.occurrences.map(({ clientId }) => clientId),
	);

	const template = cloneWorkoutEditorSource(hydrated.draft, {
		idFor: nextId,
		name: "Reusable plan",
		kind: "template-create",
		draftId: "draft-template",
		sourceWorkoutId: entityId("workout-1"),
	});
	expect(template.mode).toEqual({ kind: "template-create", sourceWorkoutId: "workout-1" });
	expect(template).toMatchObject({
		images: [],
		endedAt: undefined,
		comment: undefined,
		startedAt: undefined,
		caloriesBurnt: undefined,
		activeDuration: undefined,
		activeDurationStartedAt: undefined,
	});
	expect(template.occurrences[0]?.notes).toEqual([]);
	expect(template.occurrences[0]).toMatchObject({ images: [], videos: [] });
	expect(template.occurrences[0]?.sets[0]).toMatchObject({
		rpe: "8",
		reps: "5",
		weight: "100",
		included: false,
		note: "Set note",
		eventId: undefined,
		confirmedAt: undefined,
	});
	expect(template.supersets[0]?.occurrenceIds).toEqual(
		template.occurrences.map(({ clientId }) => clientId),
	);
	expect(template.occurrences[0]?.clientId).toMatch(/^fresh-/);
	expect(template.occurrences[0]?.sets[0]?.clientId).toMatch(/^fresh-/);
	expect(Schema.decodeSync(WorkoutEditorDraftSchema)(template)).toEqual(template);
});
