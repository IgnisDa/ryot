import { EntityId } from "@ryot-app/plugin-kit/schema";
import { assert, describe, expect, it } from "vitest";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { exerciseOccurrence, liveDraft, startTime } from "../../tests/client/draft-fixtures";
import { reconcileWorkoutTimers } from "./actions";
import {
	confirmSet,
	invalidateWorkoutCountdowns,
	pauseCountdown,
	pauseStopwatch,
	pauseWorkout,
	resetStopwatch,
	resumeCountdown,
	resumeStopwatch,
	resumeWorkout,
	shiftCountdown,
	startExecution,
	startRest,
	unconfirmSet,
} from "./timers";

const now = Date.parse(startTime);

const reconcile = (
	value: WorkoutEditorDraft,
	observedAt: number,
	expected?: { readonly executionClientId?: string; readonly restClientId?: string },
) => reconcileWorkoutTimers(value, observedAt, { expected, settings: {}, prompt: false });

const draft = (overrides: Partial<WorkoutEditorDraft> = {}) =>
	liveDraft({
		occurrences: [exerciseOccurrence("reps_and_duration", { reps: "0", duration: "2" })],
		...overrides,
	});

const targetOccurrence = (value: WorkoutEditorDraft) => {
	const occurrence = value.occurrences[0];
	assert(occurrence);
	return occurrence;
};

const targetSet = (value: WorkoutEditorDraft) => {
	const set = targetOccurrence(value).sets[0];
	assert(set);
	return set;
};

const includedDraft = (value: WorkoutEditorDraft) => {
	const occurrence = targetOccurrence(value);
	const set = targetSet(value);
	return { ...value, occurrences: [{ ...occurrence, sets: [{ ...set, included: true }] }] };
};

describe("workout editor timers", () => {
	it("does not confirm invalid edited measurements or template sets", () => {
		const execution = startExecution(draft(), "occurrence-1", "set-1", now, "execution-1").draft;
		const edited = {
			...execution,
			occurrences: [
				{ ...targetOccurrence(execution), sets: [{ ...targetSet(execution), reps: "" }] },
			],
		};
		const expired = reconcile(edited, now + 300_000).draft;
		expect(targetSet(expired).included).toBe(false);
		expect(expired.executionCountdown).toBeUndefined();
		const zero = {
			...draft(),
			occurrences: [
				{ ...targetOccurrence(draft()), sets: [{ ...targetSet(draft()), duration: "0" }] },
			],
		};
		expect(targetSet(confirmSet(zero, "occurrence-1", "set-1", now).draft).included).toBe(true);
		expect(
			confirmSet(draft({ mode: { kind: "template-create" } }), "occurrence-1", "set-1", now)
				.changed,
		).toBe(false);
	});

	it("keeps the stopwatch independent of workout pauses", () => {
		const running = resumeStopwatch(draft(), now).draft;
		const workoutPaused = pauseWorkout(running, now + 5_000).draft;
		expect(workoutPaused.stopwatchStartedAt).toBe(startTime);
		const stopped = pauseStopwatch(workoutPaused, now + 10_000).draft;
		expect(stopped.pausedStopwatchSeconds).toBe(10);
		expect(stopped.activeDuration).toBe(5);
		expect(resetStopwatch(stopped).draft.pausedStopwatchSeconds).toBe(0);
	});
	it("converts the displayed duration, accepts zero measurements, and rejects an empty duration", () => {
		const minutes = startExecution(draft(), "occurrence-1", "set-1", now, "execution-1");
		expect(minutes.changed).toBe(true);
		expect(minutes.draft.executionCountdown).toMatchObject({
			durationSeconds: 120,
			clientId: "execution-1",
			exerciseId: "exercise-1",
			deadline: "2026-10-15T10:02:00.000Z",
		});
		const seconds = startExecution(
			draft({
				occurrences: [
					{
						...targetOccurrence(draft()),
						display: { weightUnit: "kg", distanceUnit: "km", durationUnit: "seconds" },
					},
				],
			}),
			"occurrence-1",
			"set-1",
			now,
			"execution-2",
		);
		expect(seconds.draft.executionCountdown?.durationSeconds).toBe(2);
		const invalid = startExecution(
			draft({
				occurrences: [
					{ ...targetOccurrence(draft()), sets: [{ ...targetSet(draft()), duration: "0" }] },
				],
			}),
			"occurrence-1",
			"set-1",
			now,
			"execution-3",
		);
		expect(invalid.changed).toBe(false);
	});

	it("pauses and resumes each timer with its remaining time and ignores stale timer identities", () => {
		const execution = startExecution(draft(), "occurrence-1", "set-1", now, "execution-1");
		expect(execution.changed).toBe(true);
		const paused = pauseCountdown(
			execution.draft,
			"executionCountdown",
			now + 30_000,
			"execution-1",
		);
		expect(
			pauseCountdown(execution.draft, "executionCountdown", now + 300_000).draft.executionCountdown
				?.deadline,
		).toBe("2026-10-15T10:02:00.000Z");
		expect(paused.draft.executionCountdown?.pausedRemainingSeconds).toBe(90);
		const staleResume = resumeCountdown(
			paused.draft,
			"executionCountdown",
			now + 60_000,
			"execution-old",
		);
		expect(staleResume.changed).toBe(false);
		const resumed = resumeCountdown(
			paused.draft,
			"executionCountdown",
			now + 60_000,
			"execution-1",
		);
		expect(resumed.draft.executionCountdown).toMatchObject({
			clientId: "execution-1",
			deadline: "2026-10-15T10:02:30.000Z",
		});
		const resting = startRest(
			includedDraft(resumed.draft),
			"occurrence-1",
			"set-1",
			20,
			now,
			"rest-1",
		);
		expect(resting.changed).toBe(true);
		const restPause = pauseCountdown(resting.draft, "restCountdown", now + 5_000, "rest-1");
		expect(restPause.draft.restCountdown?.pausedRemainingSeconds).toBe(15);
		const restResume = resumeCountdown(restPause.draft, "restCountdown", now + 10_000, "rest-1");
		expect(restResume.draft.restCountdown?.deadline).toBe("2026-10-15T10:00:25.000Z");
	});

	it("confirms and unconfirms sets while clearing only their timers", () => {
		const execution = startExecution(draft(), "occurrence-1", "set-1", now, "execution-1");
		expect(execution.changed).toBe(true);
		const confirmed = confirmSet(execution.draft, "occurrence-1", "set-1", now + 10_000);
		expect(targetSet(confirmed.draft)).toMatchObject({
			included: true,
			occurredAt: "2026-10-15T10:00:10.000Z",
			confirmedAt: "2026-10-15T10:00:10.000Z",
		});
		expect(confirmed.draft.executionCountdown).toBeUndefined();
		expect(confirmed.draft.activeDurationStartedAt).toBe(startTime);
		const startedRest = startRest(confirmed.draft, "occurrence-1", "set-1", 0, now, "rest-0");
		expect(startedRest.draft.restCountdown).toBeUndefined();
		const unconfirmed = unconfirmSet(confirmed.draft, "occurrence-1", "set-1");
		expect(targetSet(unconfirmed.draft)).toMatchObject({
			included: false,
			confirmedAt: undefined,
			restTimerStartedAt: undefined,
		});
	});

	it("reconciles late execution exactly once at its deadline and clears expired rest", () => {
		const execution = startExecution(draft(), "occurrence-1", "set-1", now, "execution-1");
		expect(execution.changed).toBe(true);
		const late = reconcile(execution.draft, now + 300_000);
		expect(targetSet(late.draft).confirmedAt).toBe("2026-10-15T10:02:00.000Z");
		expect(late.draft.executionCountdown).toBeUndefined();
		expect(reconcile(late.draft, now + 300_000).changed).toBe(false);
		const confirmed = confirmSet(execution.draft, "occurrence-1", "set-1", now);
		const rest = startRest(
			includedDraft(confirmed.draft),
			"occurrence-1",
			"set-1",
			5,
			now,
			"rest-1",
		);
		expect(reconcile(rest.draft, now + 10_000).draft.restCountdown).toBeUndefined();
	});

	it("clears timers for deleted or replaced targets and refuses stale expiry callbacks", () => {
		const execution = startExecution(draft(), "occurrence-1", "set-1", now, "execution-1");
		expect(execution.changed).toBe(true);
		const replaced = {
			...execution.draft,
			occurrences: [
				{ ...targetOccurrence(execution.draft), exerciseId: EntityId.make("exercise-2") },
			],
		};
		expect(invalidateWorkoutCountdowns(replaced).draft.executionCountdown).toBeUndefined();
		const stale = reconcile(execution.draft, now + 300_000, { executionClientId: "execution-old" });
		expect(stale.draft.executionCountdown?.clientId).toBe("execution-1");
		const deleted = {
			...execution.draft,
			occurrences: [{ ...targetOccurrence(execution.draft), sets: [] }],
		};
		expect(reconcile(deleted, now).draft.executionCountdown).toBeUndefined();
	});

	it("pauses workout active duration separately and clears timers for non-live drafts", () => {
		const paused = pauseWorkout(draft(), now + 5_000);
		expect(paused.draft.activeDuration).toBe(5);
		expect(paused.draft.activeDurationStartedAt).toBeUndefined();
		const resumed = resumeWorkout(paused.draft, now + 10_000);
		expect(resumed.draft.activeDurationStartedAt).toBe("2026-10-15T10:00:10.000Z");
		const execution = startExecution(draft(), "occurrence-1", "set-1", now, "execution-1");
		expect(execution.changed).toBe(true);
		const historical = {
			...execution.draft,
			mode: {
				conflictToken: "token",
				kind: "historical" as const,
				entityId: EntityId.make("workout-1"),
			},
		};
		expect(reconcile(historical, now).draft.executionCountdown).toBeUndefined();
	});
});

const restDraft = (pausedRemainingSeconds?: number) =>
	liveDraft({
		restCountdown: {
			setId: "set",
			clientId: "rest",
			durationSeconds: 60,
			occurrenceId: "occurrence",
			deadline: "2026-10-15T10:00:20.000Z",
			exerciseId: EntityId.make("exercise"),
			...(pausedRemainingSeconds === undefined ? {} : { pausedRemainingSeconds }),
		},
	});

describe("shiftCountdown", () => {
	it("moves a running deadline by whole steps and never before now", () => {
		expect(
			shiftCountdown(restDraft(), "restCountdown", "rest", 15, now).restCountdown?.deadline,
		).toBe("2026-10-15T10:00:35.000Z");
		expect(
			shiftCountdown(restDraft(), "restCountdown", "rest", -30, now).restCountdown?.deadline,
		).toBe(startTime);
	});

	it("shifts paused time without going below zero", () => {
		expect(
			shiftCountdown(restDraft(10), "restCountdown", "rest", -15, now).restCountdown
				?.pausedRemainingSeconds,
		).toBe(0);
		expect(
			shiftCountdown(restDraft(10), "restCountdown", "rest", 15, now).restCountdown
				?.pausedRemainingSeconds,
		).toBe(25);
	});

	it("leaves the draft unchanged for a replaced countdown", () => {
		const unchanged = restDraft();
		expect(shiftCountdown(unchanged, "restCountdown", "other", 15, now)).toBe(unchanged);
		expect(shiftCountdown(unchanged, "executionCountdown", "rest", 15, now)).toBe(unchanged);
	});
});
