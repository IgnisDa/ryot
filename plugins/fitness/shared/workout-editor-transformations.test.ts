import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { assert, expect, it } from "vitest";

import { WorkoutEditorDraftSchema } from "./workout-editor-draft";
import {
	buildWorkoutEditorSaveInput,
	cloneWorkoutForRepeat,
	includedWorkoutOccurrences,
	indexWorkoutOccurrences,
	isMeaningfulTemplateSet,
	replaceWorkoutOccurrence,
	validateWorkoutDraft,
} from "./workout-editor-transformations";

const timestamp = "2026-10-15T10:00:00.000Z";

const set = (clientId: string, values: Record<string, unknown> = {}) => ({
	clientId,
	reps: "5",
	images: [],
	videos: [],
	weight: "100",
	included: true,
	setLot: "normal",
	exerciseKind: "reps_and_weight",
	restChoice: { kind: "inherited" },
	...values,
});

const occurrence = (
	clientId: string,
	sets: ReadonlyArray<ReturnType<typeof set>>,
	values: Record<string, unknown> = {},
) => ({
	sets,
	clientId,
	notes: [],
	images: [],
	videos: [],
	isCollapsed: false,
	exerciseKind: "reps_and_weight",
	exerciseId: `exercise-${clientId}`,
	...values,
});

const makeDraft = (values: Record<string, unknown> = {}) =>
	Schema.decodeUnknownSync(WorkoutEditorDraftSchema)({
		images: [],
		videos: [],
		supersets: [],
		name: "Upper body",
		draftId: "draft-1",
		startedAt: timestamp,
		activeDuration: 3600,
		caloriesBurnt: "418.4",
		displayEnergyUnit: "kJ",
		restCountdown: undefined,
		comment: "Session reflection",
		executionCountdown: undefined,
		kind: "fitness-workout-editor",
		activeDurationIntent: "preserve",
		endedAt: "2026-10-15T11:00:00.000Z",
		occurrences: [occurrence("occurrence-1", [set("set-1")])],
		mode: { kind: "historical", entityId: "workout-1", conflictToken: "source-token" },
		...values,
	});

it("reuses the complete frozen submission after recovery or context changes", () => {
	const source = makeDraft();
	const context = {
		exerciseOverridesById: {},
		unitSystem: "metric" as const,
		restSettings: { dropRestTime: 0, warmUpRestTime: 0, normalRestTime: 60, failureRestTime: 0 },
	};
	const first = buildWorkoutEditorSaveInput(
		source,
		{ submissionId: "first", submittedAt: timestamp },
		context,
	);
	assert(first.input !== undefined);
	const pending = makeDraft({ submission: first.input, name: "Changed while saving" });
	const retried = buildWorkoutEditorSaveInput(
		pending,
		{ submissionId: "different", submittedAt: "2026-10-16T10:00:00.000Z" },
		{
			...context,
			unitSystem: "imperial",
			restSettings: { ...context.restSettings, normalRestTime: 120 },
		},
	);
	expect(retried).toEqual({ issues: [], input: first.input });
});

it("replaces only one occurrence when the exercise kind stays the same", () => {
	const draft = makeDraft({
		restCountdown: {
			setId: "set-2",
			deadline: timestamp,
			durationSeconds: 90,
			clientId: "rest-countdown",
			occurrenceId: "occurrence-2",
		},
		executionCountdown: {
			setId: "set-1",
			deadline: timestamp,
			durationSeconds: 60,
			occurrenceId: "occurrence-1",
			clientId: "execution-countdown",
		},
		occurrences: [
			occurrence("occurrence-1", [
				set("set-1", { included: true, eventId: "event-1", confirmedAt: timestamp }),
			]),
			occurrence("occurrence-2", [set("set-2")]),
		],
	});
	const replaced = replaceWorkoutOccurrence(draft, "occurrence-1", {
		exerciseKind: "reps_and_weight",
		exerciseId: Schema.decodeSync(EntityId)("replacement-exercise"),
	});

	expect(replaced.kind).toBe("replaced");
	if (replaced.kind !== "replaced") {
		return;
	}
	expect(replaced.draft.occurrences[0]).toMatchObject({ exerciseId: "replacement-exercise" });
	expect(replaced.draft.occurrences[0]?.sets).toEqual(draft.occurrences[0]?.sets);
	expect(replaced.draft.occurrences[1]).toEqual(draft.occurrences[1]);
	expect(replaced.draft.executionCountdown).toBeUndefined();
	expect(replaced.draft.restCountdown).toEqual(draft.restCountdown);
	expect(
		replaceWorkoutOccurrence(draft, "occurrence-1", {
			exerciseKind: "duration",
			exerciseId: Schema.decodeSync(EntityId)("other-kind"),
		}).kind,
	).toBe("kind-mismatch");
});

it("repeats reusable data with fresh identities and clears session-only state", () => {
	const source = makeDraft({
		images: [{ type: "s3", key: "workout/cover.jpg" }],
		supersets: [
			{ color: "blue", clientId: "superset-1", occurrenceIds: ["occurrence-1", "occurrence-2"] },
		],
		occurrences: [
			occurrence(
				"occurrence-1",
				[
					set("set-1", {
						rpe: "8",
						eventId: "event-1",
						confirmedAt: timestamp,
						note: "Keep this set note",
						restTimerStartedAt: timestamp,
						videos: [{ type: "s3", key: "set/video.mp4" }],
						images: [{ type: "s3", key: "set/image.jpg" }],
						restChoice: { seconds: "90", kind: "explicit" },
					}),
				],
				{ notes: ["Keep this exercise cue"] },
			),
			occurrence("occurrence-2", [set("set-2")]),
		],
	});
	let id = 0;
	const repeated = cloneWorkoutForRepeat(source, {
		draftId: "draft-repeat",
		name: "Upper body repeat",
		idFor: () => `fresh-${(id += 1)}`,
		startedAt: "2026-10-16T10:00:00.000Z",
		sourceWorkoutId: Schema.decodeSync(EntityId)("workout-1"),
	});
	const repeatedSet = repeated.occurrences[0]?.sets[0];

	expect(repeated).toMatchObject({
		videos: [],
		images: [],
		activeDuration: 0,
		comment: undefined,
		caloriesBurnt: undefined,
		startedAt: "2026-10-16T10:00:00.000Z",
		activeDurationStartedAt: "2026-10-16T10:00:00.000Z",
		mode: { kind: "live", source: { kind: "repeat", entityId: "workout-1" } },
	});
	expect(repeated.occurrences[0]?.notes).toEqual(["Keep this exercise cue"]);
	expect(repeatedSet).toMatchObject({
		reps: "5",
		images: [],
		videos: [],
		rpe: undefined,
		included: false,
		eventId: undefined,
		confirmedAt: undefined,
		note: "Keep this set note",
		restTimerStartedAt: undefined,
		restChoice: { seconds: "90", kind: "explicit" },
	});
	expect(repeatedSet?.clientId).not.toBe("set-1");
	expect(repeated.supersets[0]?.occurrenceIds).toEqual([
		repeated.occurrences[0]?.clientId,
		repeated.occurrences[1]?.clientId,
	]);
});

it("keeps repeated exercise occurrences distinct when indexing and selecting sets", () => {
	const workout = makeDraft({
		occurrences: [
			occurrence("first", [set("first-set")], { exerciseId: "shared-exercise" }),
			occurrence("second", [set("second-set")], { exerciseId: "shared-exercise" }),
		],
	});
	expect(indexWorkoutOccurrences(workout.occurrences)).toEqual([
		{ order: 0, clientId: "first" },
		{ order: 1, clientId: "second" },
	]);
	expect(includedWorkoutOccurrences(workout).map(({ occurrence: item }) => item.clientId)).toEqual([
		"first",
		"second",
	]);
});

it("retains meaningful template sets and exercise-only entries but omits empty rows", () => {
	const plan = makeDraft({
		mode: { kind: "template-create" },
		occurrences: [
			occurrence("exercise-only", [
				set("empty", { included: false, reps: undefined, weight: undefined }),
			]),
			occurrence("planned-zero", [set("zero", { reps: "0", included: false, weight: undefined })]),
			occurrence("planned-rest", [
				set("rest", {
					included: false,
					reps: undefined,
					weight: undefined,
					restChoice: { seconds: "0", kind: "explicit" },
				}),
			]),
		],
	});
	const [exerciseOnly, plannedZero, plannedRest] = plan.occurrences.map((item) => item.sets[0]);

	assert(exerciseOnly);
	assert(plannedZero);
	assert(plannedRest);
	expect(isMeaningfulTemplateSet(exerciseOnly)).toBe(false);
	expect(isMeaningfulTemplateSet(plannedZero)).toBe(true);
	expect(isMeaningfulTemplateSet(plannedRest)).toBe(true);
	expect(
		includedWorkoutOccurrences(plan).map(({ sets, occurrence: item }) => [
			item.clientId,
			sets.length,
		]),
	).toEqual([
		["exercise-only", 0],
		["planned-zero", 1],
		["planned-rest", 1],
	]);
	const save = buildWorkoutEditorSaveInput(
		plan,
		{ submittedAt: timestamp, submissionId: "template-submission" },
		{
			unitSystem: "metric",
			exerciseOverridesById: {},
			restSettings: { dropRestTime: 0, warmUpRestTime: 0, failureRestTime: 0, normalRestTime: 60 },
		},
	);
	expect(save.issues).toEqual([]);
	if (save.input?.data.kind !== "template") {
		throw new Error("Expected template save input");
	}
	expect(save.input.data.occurrences.map(({ sets }) => sets.length)).toEqual([0, 1, 1]);
});

it("allows zero values, preserves untimed saved sets, and validates new included sets", () => {
	const draft = makeDraft({
		mode: { kind: "historical", entityId: "workout-1", conflictToken: "source-token" },
		occurrences: [
			occurrence("occurrence-1", [
				set("saved", { included: true, reps: undefined, weight: undefined, eventId: "event-1" }),
				set("deleted", { included: false, eventId: "event-2" }),
				set("new", { reps: "0", weight: "0", included: true }),
			]),
		],
	});
	const issues = validateWorkoutDraft(draft);

	expect(issues).toEqual([]);
	expect(includedWorkoutOccurrences(draft)[0]?.sets.map(({ clientId }) => clientId)).toEqual([
		"saved",
		"new",
	]);
	const unconfirmed = makeDraft({
		mode: { kind: "live" },
		occurrences: [occurrence("occurrence-1", [set("set-1", { confirmedAt: undefined })])],
	});
	expect(validateWorkoutDraft(unconfirmed).map(({ code }) => code)).toContain("unconfirmed-set");
	const unsafeReps = makeDraft({
		occurrences: [
			occurrence("occurrence-1", [set("set-1", { included: true, reps: "9007199254740992" })]),
		],
	});
	expect(validateWorkoutDraft(unsafeReps).map(({ code }) => code)).toContain("invalid-measurement");
});

it("builds compact historical input in canonical units and preserves source times", () => {
	const draft = makeDraft({
		caloriesBurnt: "418.4",
		occurrences: [
			occurrence(
				"occurrence-1",
				[
					set("set-1", {
						eventId: "event-1",
						distance: undefined,
						duration: undefined,
						weight: "220.462262",
						note: "Preserved note",
						occurredAt: "2020-02-03T04:05:06.000Z",
						restChoice: { seconds: "0", kind: "explicit" },
					}),
				],
				{ display: { weightUnit: "lb", distanceUnit: "mi", durationUnit: "minutes" } },
			),
		],
	});
	const result = buildWorkoutEditorSaveInput(
		draft,
		{ submittedAt: timestamp, submissionId: "submission-1" },
		{
			unitSystem: "metric",
			exerciseOverridesById: {},
			restSettings: { dropRestTime: 0, warmUpRestTime: 0, failureRestTime: 0, normalRestTime: 60 },
		},
	);

	expect(result.issues).toEqual([]);
	expect(result.input?.data).toMatchObject({
		kind: "workout",
		startedAt: timestamp,
		activeDuration: { kind: "preserve" },
	});
	if (result.input?.data.kind !== "workout") {
		throw new Error("Expected workout save input");
	}
	expect(result.input.data.caloriesBurnt).toBeCloseTo(100);
	expect(result.input.data.occurrences[0]?.sets[0]).toMatchObject({
		restTime: 0,
		eventId: "event-1",
		note: "Preserved note",
		measurements: { reps: 5, weight: 100 },
		occurredAt: "2020-02-03T04:05:06.000Z",
	});
});

it("converts distance and duration display units using occurrence choices before exercise overrides", () => {
	const draft = makeDraft({
		mode: { kind: "historical", entityId: "workout-1", conflictToken: "source-token" },
		occurrences: [
			occurrence(
				"run-occurrence",
				[
					set("run-set", {
						distance: "1",
						duration: "2.5",
						reps: undefined,
						weight: undefined,
						eventId: "run-event",
						exerciseKind: "distance_and_duration",
					}),
				],
				{
					exerciseId: "running-exercise",
					exerciseKind: "distance_and_duration",
					display: { weightUnit: "lb", distanceUnit: "mi", durationUnit: "minutes" },
				},
			),
		],
	});
	const result = buildWorkoutEditorSaveInput(
		draft,
		{ submittedAt: timestamp, submissionId: "submission-units" },
		{
			unitSystem: "metric",
			exerciseOverridesById: { "running-exercise": { defaultDurationUnit: "seconds" } },
			restSettings: { dropRestTime: 0, warmUpRestTime: 0, failureRestTime: 0, normalRestTime: 60 },
		},
	);

	expect(result.issues).toEqual([]);
	if (result.input?.data.kind !== "workout") {
		throw new Error("Expected workout save input");
	}
	expect(result.input.data.occurrences[0]?.sets[0]?.measurements).toEqual({
		duration: 150,
		distance: 1.609344,
	});
});

it("adds the unpaused active interval to a new workout save", () => {
	const draft = makeDraft({
		activeDuration: 1.7,
		mode: { kind: "live" },
		activeDurationIntent: "set",
		activeDurationStartedAt: "2026-10-15T10:00:00.400Z",
		occurrences: [occurrence("occurrence-1", [set("set-1", { confirmedAt: timestamp })])],
	});
	const result = buildWorkoutEditorSaveInput(
		draft,
		{ submissionId: "submission-duration", submittedAt: "2026-10-15T10:00:02.000Z" },
		{
			unitSystem: "metric",
			exerciseOverridesById: {},
			restSettings: { dropRestTime: 0, warmUpRestTime: 0, failureRestTime: 0, normalRestTime: 60 },
		},
	);

	expect(result.issues).toEqual([]);
	if (result.input?.data.kind !== "workout") {
		throw new Error("Expected workout save input");
	}
	expect(result.input.data.activeDuration).toEqual({ seconds: 3, kind: "set" });
});
