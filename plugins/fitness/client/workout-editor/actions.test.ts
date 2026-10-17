import { Schema } from "@ryot-app/plugin-kit/effect";
import { assert, describe, expect, it } from "vitest";

import {
	WorkoutEditorDraftSchema,
	type WorkoutEditorDraft,
	type WorkoutEditorOccurrence,
	type WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import type { WorkoutPreferenceSettings } from "../../shared/workout-editor-preferences";
import {
	changeOccurrenceDisplay,
	completeWorkoutSet,
	cycleWorkoutSuperset,
	finishWorkoutDraft,
	newWorkoutOccurrence,
	newWorkoutSet,
	nextWorkoutOccurrence,
	removeWorkoutItems,
	resolvePendingRest,
} from "./actions";

const startedAt = "2026-10-16T10:00:00.000Z";
const startTime = Date.parse(startedAt);

const workoutSet = (clientId: string, overrides: Record<string, unknown> = {}) => ({
	clientId,
	reps: "5",
	weight: "10",
	included: false,
	setLot: "normal",
	exerciseKind: "reps_and_weight",
	restChoice: { kind: "inherited" },
	...overrides,
});

const workoutOccurrence = (clientId: string, overrides: Record<string, unknown> = {}) => ({
	clientId,
	notes: [],
	images: [],
	videos: [],
	isCollapsed: false,
	exerciseKind: "reps_and_weight",
	exerciseId: `${clientId}-exercise`,
	sets: [workoutSet(`${clientId}-set`)],
	...overrides,
});

const workoutDraft = (overrides: Record<string, unknown> = {}): WorkoutEditorDraft =>
	Schema.decodeUnknownSync(WorkoutEditorDraftSchema)({
		startedAt,
		images: [],
		videos: [],
		supersets: [],
		name: "Workout",
		activeDuration: 0,
		draftId: "draft-1",
		mode: { kind: "live" },
		displayEnergyUnit: "kcal",
		activeDurationIntent: "set",
		kind: "fitness-workout-editor",
		activeDurationStartedAt: startedAt,
		occurrences: [workoutOccurrence("occurrence-1")],
		...overrides,
	});

const findOccurrence = (
	value: WorkoutEditorDraft,
	occurrenceId: string,
): WorkoutEditorOccurrence => {
	const result = value.occurrences.find(({ clientId }) => clientId === occurrenceId);
	assert(result);
	return result;
};

const findSet = (
	value: WorkoutEditorDraft,
	occurrenceId: string,
	setId: string,
): WorkoutEditorSet => {
	const result = findOccurrence(value, occurrenceId).sets.find(
		({ clientId }) => clientId === setId,
	);
	assert(result);
	return result;
};

const preferences = (
	overrides: Partial<WorkoutPreferenceSettings> = {},
): WorkoutPreferenceSettings => ({
	dropRestTime: 0,
	warmUpRestTime: 0,
	muteSounds: false,
	normalRestTime: 60,
	failureRestTime: 0,
	energyUnit: "kcal",
	unitSystem: "metric",
	promptForRestTimer: false,
	startTimerForDurationExercises: false,
	...overrides,
});

const isoAt = (time: number) => new Date(time).toISOString();

describe("workout editor actions", () => {
	it("stays on an ordinary exercise until its sets are complete and leaves finished supersets", () => {
		const ordinary = workoutDraft({
			occurrences: [workoutOccurrence("first"), workoutOccurrence("next")],
		});
		expect(nextWorkoutOccurrence(ordinary, "first")).toBe("first");
		const grouped = workoutDraft({
			supersets: [{ color: "blue", clientId: "group", occurrenceIds: ["second", "first"] }],
			occurrences: [
				workoutOccurrence("first", { sets: [workoutSet("set-first", { included: true })] }),
				workoutOccurrence("second", { sets: [workoutSet("set-second", { included: true })] }),
				workoutOccurrence("next"),
			],
		});
		expect(nextWorkoutOccurrence(grouped, "second")).toBe("next");
		expect(cycleWorkoutSuperset(grouped, "first")).toBe("second");
		expect(cycleWorkoutSuperset(grouped, "second")).toBe("first");
	});
	it("converts measurements between display units and back without changing quantities", () => {
		const original = findOccurrence(
			workoutDraft({
				occurrences: [
					workoutOccurrence("occurrence-1", {
						display: { weightUnit: "kg", distanceUnit: "km", durationUnit: "seconds" },
						sets: [workoutSet("set-1", { weight: "75", distance: "10", duration: "120" })],
					}),
				],
			}),
			"occurrence-1",
		);
		const imperial = changeOccurrenceDisplay(original, {
			weightUnit: "lb",
			distanceUnit: "mi",
			durationUnit: "minutes",
		});
		const converted = imperial.sets[0];
		assert(converted);
		expect(Number(converted.weight)).toBeCloseTo(75 / 0.45359237);
		expect(Number(converted.distance)).toBeCloseTo(10 / 1.609344);
		expect(Number(converted.duration)).toBe(2);

		const metric = changeOccurrenceDisplay(imperial, {
			weightUnit: "kg",
			distanceUnit: "km",
			durationUnit: "seconds",
		});
		const restored = metric.sets[0];
		assert(restored);
		expect(Number(restored.weight)).toBeCloseTo(75);
		expect(Number(restored.distance)).toBeCloseTo(10);
		expect(Number(restored.duration)).toBe(120);
	});

	it("keeps blank and invalid measurement strings unchanged during unit conversion", () => {
		const original = findOccurrence(
			workoutDraft({
				occurrences: [
					workoutOccurrence("occurrence-1", {
						display: { weightUnit: "kg", distanceUnit: "km", durationUnit: "seconds" },
						sets: [workoutSet("set-1", { weight: "", distance: "  ", duration: "not-a-number" })],
					}),
				],
			}),
			"occurrence-1",
		);
		const converted = changeOccurrenceDisplay(original, {
			weightUnit: "lb",
			distanceUnit: "mi",
			durationUnit: "minutes",
		});
		expect(converted.sets[0]).toMatchObject({
			weight: "",
			distance: "  ",
			duration: "not-a-number",
		});
	});

	it("copies measurements into a new set and clears saved and completed set data", () => {
		const previous = findSet(
			workoutDraft({
				occurrences: [
					workoutOccurrence("occurrence-1", {
						sets: [
							workoutSet("saved-set", {
								rpe: "9",
								reps: "8",
								weight: "80",
								distance: "4",
								duration: "30",
								included: true,
								setLot: "drop",
								eventId: "event-1",
								occurredAt: startedAt,
								confirmedAt: startedAt,
								note: "Keep form steady",
								restTimerStartedAt: startedAt,
								restChoice: { seconds: "45", kind: "explicit" },
							}),
						],
					}),
				],
			}),
			"occurrence-1",
			"saved-set",
		);

		expect(newWorkoutSet("new-set", "reps_and_weight", previous)).toEqual({
			reps: "8",
			weight: "80",
			distance: "4",
			duration: "30",
			included: false,
			setLot: "normal",
			clientId: "new-set",
			exerciseKind: "reps_and_weight",
			restChoice: { kind: "inherited" },
		});
	});

	it("removes selected workout items, repairs small groups, and preserves retained event IDs", () => {
		const original = workoutDraft({
			supersets: [
				{
					color: "red",
					clientId: "small-group",
					occurrenceIds: ["remove-occurrence", "keep-occurrence"],
				},
				{
					color: "blue",
					clientId: "retained-group",
					occurrenceIds: ["remove-occurrence", "keep-occurrence", "last-occurrence"],
				},
			],
			occurrences: [
				workoutOccurrence("remove-occurrence", {
					sets: [workoutSet("removed-occurrence-set", { eventId: "event-removed-occurrence" })],
				}),
				workoutOccurrence("keep-occurrence", {
					sets: [
						workoutSet("keep-set", { eventId: "event-keep" }),
						workoutSet("remove-set", { eventId: "event-removed-set" }),
					],
				}),
				workoutOccurrence("last-occurrence", {
					sets: [workoutSet("last-set", { eventId: "event-last" })],
				}),
			],
		});

		const result = removeWorkoutItems(original, ["remove-occurrence"], ["remove-set"]);
		expect(result.occurrences.map(({ clientId }) => clientId)).toEqual([
			"keep-occurrence",
			"last-occurrence",
		]);
		expect(findOccurrence(result, "keep-occurrence").sets.map(({ clientId }) => clientId)).toEqual([
			"keep-set",
		]);
		expect(findSet(result, "keep-occurrence", "keep-set").eventId).toBe("event-keep");
		expect(findSet(result, "last-occurrence", "last-set").eventId).toBe("event-last");
		expect(result.supersets).toEqual([
			{
				color: "blue",
				clientId: "retained-group",
				occurrenceIds: ["keep-occurrence", "last-occurrence"],
			},
		]);
	});

	it("cycles through workout-order group members, skips completed sets, and treats repeated exercises separately", () => {
		const value = workoutDraft({
			supersets: [
				{
					color: "green",
					clientId: "group-1",
					occurrenceIds: ["occurrence-3", "occurrence-1", "occurrence-2"],
				},
			],
			occurrences: [
				workoutOccurrence("occurrence-1", { exerciseId: "repeated-exercise" }),
				workoutOccurrence("occurrence-2", {
					exerciseId: "repeated-exercise",
					sets: [workoutSet("completed-set", { included: true })],
				}),
				workoutOccurrence("occurrence-3", { exerciseId: "repeated-exercise" }),
				workoutOccurrence("outside-group"),
			],
		});

		expect(nextWorkoutOccurrence(value, "occurrence-1")).toBe("occurrence-3");
		expect(nextWorkoutOccurrence(value, "occurrence-3")).toBe("occurrence-1");
	});

	it("confirms zero measurements and starts inherited rest at the completion time", () => {
		const value = workoutDraft({
			occurrences: [
				workoutOccurrence("occurrence-1", {
					sets: [workoutSet("set-1", { reps: "0", weight: "0" })],
				}),
			],
		});
		const result = completeWorkoutSet(value, {
			prompt: false,
			overrides: {},
			setId: "set-1",
			now: startTime,
			timerId: "rest-1",
			occurrenceId: "occurrence-1",
			settings: preferences({ normalRestTime: 30 }),
		});

		expect(findSet(result, "occurrence-1", "set-1")).toMatchObject({
			reps: "0",
			weight: "0",
			included: true,
			occurredAt: startedAt,
			confirmedAt: startedAt,
			restTimerStartedAt: startedAt,
			restChoice: { seconds: "30", kind: "explicit" },
		});
		expect(result.restCountdown).toMatchObject({
			clientId: "rest-1",
			durationSeconds: 30,
			deadline: isoAt(startTime + 30_000),
		});
	});

	it("uses an explicit rest choice instead of changed normal rest preferences", () => {
		const value = workoutDraft({
			occurrences: [
				workoutOccurrence("occurrence-1", {
					sets: [workoutSet("set-1", { restChoice: { seconds: "7", kind: "explicit" } })],
				}),
			],
		});
		const result = completeWorkoutSet(value, {
			prompt: false,
			setId: "set-1",
			now: startTime,
			timerId: "rest-1",
			occurrenceId: "occurrence-1",
			overrides: { normalRestTime: 45 },
			settings: preferences({ normalRestTime: 90 }),
		});

		expect(findSet(result, "occurrence-1", "set-1")).toMatchObject({
			restTimerStartedAt: startedAt,
			restChoice: { seconds: "7", kind: "explicit" },
		});
		expect(result.restCountdown).toMatchObject({ durationSeconds: 7 });
	});

	it("advances immediately when the resolved rest is zero", () => {
		const value = workoutDraft({
			occurrences: [workoutOccurrence("occurrence-1"), workoutOccurrence("occurrence-2")],
		});
		const result = completeWorkoutSet(value, {
			prompt: true,
			overrides: {},
			now: startTime,
			timerId: "rest-1",
			setId: "occurrence-1-set",
			occurrenceId: "occurrence-1",
			settings: preferences({ normalRestTime: 0 }),
		});

		expect(result.pendingRest).toBeUndefined();
		expect(result.restCountdown).toBeUndefined();
		expect(result.activeOccurrenceId).toBe("occurrence-2");
		expect(findSet(result, "occurrence-1", "occurrence-1-set").restTimerStartedAt).toBe(startedAt);
	});

	it("keeps prompted rest pending until it starts or is skipped", () => {
		const value = workoutDraft({
			occurrences: [workoutOccurrence("occurrence-1"), workoutOccurrence("occurrence-2")],
		});
		const prompted = completeWorkoutSet(value, {
			prompt: true,
			overrides: {},
			now: startTime,
			timerId: "rest-1",
			setId: "occurrence-1-set",
			occurrenceId: "occurrence-1",
			settings: preferences({ normalRestTime: 20 }),
		});
		expect(prompted.pendingRest).toEqual({
			seconds: 20,
			setId: "occurrence-1-set",
			occurrenceId: "occurrence-1",
			exerciseId: "occurrence-1-exercise",
		});
		expect(prompted.restCountdown).toBeUndefined();
		expect(
			findSet(prompted, "occurrence-1", "occurrence-1-set").restTimerStartedAt,
		).toBeUndefined();

		const started = resolvePendingRest(prompted, startTime + 1_000, "prompted-rest", false);
		expect(started.pendingRest).toBeUndefined();
		expect(started.activeOccurrenceId).toBe("occurrence-2");
		expect(started.restCountdown?.deadline).toBe(isoAt(startTime + 21_000));
		expect(findSet(started, "occurrence-1", "occurrence-1-set").restTimerStartedAt).toBe(
			isoAt(startTime + 1_000),
		);

		const skipped = resolvePendingRest(prompted, startTime + 1_000, "unused-rest", true);
		expect(skipped.pendingRest).toBeUndefined();
		expect(skipped.restCountdown).toBeUndefined();
		expect(skipped.activeOccurrenceId).toBe("occurrence-2");
		expect(findSet(skipped, "occurrence-1", "occurrence-1-set").restTimerStartedAt).toBeUndefined();
	});

	it("does not leave a rest countdown overdue when completion is observed after the full rest", () => {
		const result = completeWorkoutSet(workoutDraft(), {
			prompt: false,
			overrides: {},
			now: startTime,
			timerId: "rest-1",
			setId: "occurrence-1-set",
			occurrenceId: "occurrence-1",
			observedAt: startTime + 60_000,
			settings: preferences({ normalRestTime: 60 }),
		});

		expect(result.restCountdown).toBeUndefined();
		expect(findSet(result, "occurrence-1", "occurrence-1-set").restTimerStartedAt).toBe(startedAt);
	});

	it("finishes a live workout with elapsed active time and clears its workout timers", () => {
		const value = workoutDraft({
			activeDuration: 300,
			activeDurationStartedAt: isoAt(startTime + 900_000),
			pendingRest: {
				seconds: 30,
				setId: "occurrence-1-set",
				occurrenceId: "occurrence-1",
				exerciseId: "occurrence-1-exercise",
			},
			restCountdown: {
				clientId: "rest-1",
				durationSeconds: 30,
				setId: "occurrence-1-set",
				occurrenceId: "occurrence-1",
				exerciseId: "occurrence-1-exercise",
				deadline: isoAt(startTime + 1_230_000),
			},
			executionCountdown: {
				durationSeconds: 30,
				clientId: "execution-1",
				setId: "occurrence-1-set",
				occurrenceId: "occurrence-1",
				exerciseId: "occurrence-1-exercise",
				deadline: isoAt(startTime + 1_230_000),
			},
		});
		const result = finishWorkoutDraft(value, startTime + 1_200_000);

		expect(result.endedAt).toBe(isoAt(startTime + 1_200_000));
		expect(result.activeDuration).toBe(600);
		expect(result.activeDurationStartedAt).toBeUndefined();
		expect(result.pendingRest).toBeUndefined();
		expect(result.restCountdown).toBeUndefined();
		expect(result.executionCountdown).toBeUndefined();
	});

	it("leaves template and historical drafts unchanged when finish is requested", () => {
		const template = workoutDraft({ mode: { kind: "template-create" } });
		const historical = workoutDraft({
			mode: { kind: "historical", entityId: "workout-1", conflictToken: "conflict-1" },
		});

		expect(finishWorkoutDraft(template, startTime + 60_000)).toBe(template);
		expect(finishWorkoutDraft(historical, startTime + 60_000)).toBe(historical);
	});

	it("resolves a new occurrence display from unit and exercise preferences", () => {
		const value = newWorkoutOccurrence({
			setId: "new-set",
			id: "new-occurrence",
			kind: "reps_and_weight",
			overrides: { defaultDurationUnit: "seconds" },
			settings: preferences({ unitSystem: "imperial" }),
			exerciseId: findOccurrence(workoutDraft(), "occurrence-1").exerciseId,
		});

		expect(value.display).toMatchObject({
			weightUnit: "lb",
			distanceUnit: "mi",
			durationUnit: "seconds",
		});
	});
});
