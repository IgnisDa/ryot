import type {
	WorkoutEditorCountdownSchema,
	WorkoutEditorDraft,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import { requiredWorkoutMeasurementsByKind } from "../../shared/workout-set";

type Countdown = typeof WorkoutEditorCountdownSchema.Type;

type TimerTransition = {
	readonly changed: boolean;
	readonly draft: WorkoutEditorDraft;
	readonly kind: "changed" | "unchanged" | "invalid" | "not-found";
};

type ExpectedCountdowns = { readonly executionClientId?: string; readonly restClientId?: string };

const unchanged = (draft: WorkoutEditorDraft, kind: TimerTransition["kind"] = "unchanged") =>
	({ kind, draft, changed: false }) satisfies TimerTransition;

const changed = (draft: WorkoutEditorDraft) =>
	({ draft, changed: true, kind: "changed" }) satisfies TimerTransition;

const isoAt = (millis: number) =>
	Number.isFinite(millis) && Math.abs(millis) <= 8.64e15
		? new Date(millis).toISOString()
		: undefined;

const getTarget = (draft: WorkoutEditorDraft, occurrenceId: string, setId: string) => {
	const occurrence = draft.occurrences.find(({ clientId }) => clientId === occurrenceId);
	const set = occurrence?.sets.find(({ clientId }) => clientId === setId);
	return occurrence && set ? { set, occurrence } : undefined;
};

const countdownMatchesTarget = (draft: WorkoutEditorDraft, countdown: Countdown) => {
	const target = getTarget(draft, countdown.occurrenceId, countdown.setId);
	return target !== undefined && target.occurrence.exerciseId === countdown.exerciseId;
};

const clearTargetCountdowns = (draft: WorkoutEditorDraft, occurrenceId: string, setId: string) => ({
	...draft,
	restCountdown:
		draft.restCountdown?.occurrenceId === occurrenceId && draft.restCountdown.setId === setId
			? undefined
			: draft.restCountdown,
	executionCountdown:
		draft.executionCountdown?.occurrenceId === occurrenceId &&
		draft.executionCountdown.setId === setId
			? undefined
			: draft.executionCountdown,
});

const parseMeasurement = (set: WorkoutEditorSet, field: keyof WorkoutEditorSet) => {
	const value = set[field];
	if (typeof value !== "string" || value.trim() === "") {
		return undefined;
	}
	const parsed = Number(value.trim());
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const validMeasurements = (set: WorkoutEditorSet) =>
	requiredWorkoutMeasurementsByKind[set.exerciseKind].every((field) => {
		const value = parseMeasurement(set, field);
		return value !== undefined && (field !== "reps" || Number.isSafeInteger(value));
	});

export const invalidateWorkoutCountdowns = (draft: WorkoutEditorDraft) => {
	if (draft.mode.kind !== "live") {
		if (draft.restCountdown === undefined && draft.executionCountdown === undefined) {
			return unchanged(draft);
		}
		return changed({ ...draft, restCountdown: undefined, executionCountdown: undefined });
	}
	const restCountdown =
		draft.restCountdown !== undefined &&
		countdownMatchesTarget(draft, draft.restCountdown) &&
		getTarget(draft, draft.restCountdown.occurrenceId, draft.restCountdown.setId)?.set.included
			? draft.restCountdown
			: undefined;
	const executionCountdown =
		draft.executionCountdown !== undefined &&
		countdownMatchesTarget(draft, draft.executionCountdown) &&
		!getTarget(draft, draft.executionCountdown.occurrenceId, draft.executionCountdown.setId)?.set
			.included
			? draft.executionCountdown
			: undefined;
	if (restCountdown === draft.restCountdown && executionCountdown === draft.executionCountdown) {
		return unchanged(draft);
	}
	return changed({ ...draft, restCountdown, executionCountdown });
};

export const startExecution = (
	draft: WorkoutEditorDraft,
	occurrenceId: string,
	setId: string,
	now: number,
	id: string,
): TimerTransition => {
	const target = getTarget(draft, occurrenceId, setId);
	const startedAt = isoAt(now);
	if (draft.mode.kind !== "live" || !target || startedAt === undefined || id.length === 0) {
		return unchanged(draft, target ? "invalid" : "not-found");
	}
	const { set, occurrence } = target;
	if (set.included || !validMeasurements(set)) {
		return unchanged(draft, "invalid");
	}
	const displayedDuration = parseMeasurement(set, "duration");
	const durationSeconds =
		displayedDuration === undefined
			? undefined
			: displayedDuration * (occurrence.display?.durationUnit === "seconds" ? 1 : 60);
	if (
		durationSeconds === undefined ||
		!Number.isFinite(durationSeconds) ||
		durationSeconds <= 0 ||
		durationSeconds > (8.64e15 - now) / 1000
	) {
		return unchanged(draft, "invalid");
	}
	const deadline = isoAt(now + durationSeconds * 1000);
	if (deadline === undefined) {
		return unchanged(draft, "invalid");
	}
	const executionCountdown: Countdown = {
		setId,
		deadline,
		clientId: id,
		occurrenceId,
		durationSeconds,
		exerciseId: occurrence.exerciseId,
	};
	return changed({ ...draft, executionCountdown });
};

export const startRest = (
	draft: WorkoutEditorDraft,
	occurrenceId: string,
	setId: string,
	seconds: number,
	now: number,
	id: string,
): TimerTransition => {
	const target = getTarget(draft, occurrenceId, setId);
	const startedAt = isoAt(now);
	if (
		draft.mode.kind !== "live" ||
		!target ||
		!target.set.included ||
		startedAt === undefined ||
		!Number.isFinite(seconds) ||
		seconds < 0 ||
		id.length === 0 ||
		seconds > (8.64e15 - now) / 1000
	) {
		return unchanged(draft, target ? "invalid" : "not-found");
	}
	const { occurrence } = target;
	const occurrences = draft.occurrences.map((candidate) =>
		candidate.clientId !== occurrenceId
			? candidate
			: {
					...candidate,
					sets: candidate.sets.map((candidateSet) =>
						candidateSet.clientId === setId
							? { ...candidateSet, restTimerStartedAt: startedAt }
							: candidateSet,
					),
				},
	);
	const restCountdown =
		seconds === 0
			? undefined
			: {
					setId,
					clientId: id,
					occurrenceId,
					durationSeconds: seconds,
					exerciseId: occurrence.exerciseId,
					deadline: isoAt(now + seconds * 1000) ?? startedAt,
				};
	return changed({ ...draft, occurrences, restCountdown });
};

export const confirmSet = (
	draft: WorkoutEditorDraft,
	occurrenceId: string,
	setId: string,
	now: number,
): TimerTransition => {
	const target = getTarget(draft, occurrenceId, setId);
	const confirmedAt = isoAt(now);
	if (
		!target ||
		confirmedAt === undefined ||
		draft.mode.kind !== "live" ||
		!validMeasurements(target.set)
	) {
		return unchanged(draft, target ? "invalid" : "not-found");
	}
	const occurredAt = target.set.occurredAt ?? confirmedAt;
	const occurrences = draft.occurrences.map((occurrence) =>
		occurrence.clientId !== occurrenceId
			? occurrence
			: {
					...occurrence,
					sets: occurrence.sets.map((set) =>
						set.clientId === setId ? { ...set, occurredAt, confirmedAt, included: true } : set,
					),
				},
	);
	const cleaned = clearTargetCountdowns({ ...draft, occurrences }, occurrenceId, setId);
	const activeDurationStartedAt =
		draft.activeDurationStartedAt === undefined &&
		draft.startedAt !== undefined &&
		draft.endedAt === undefined
			? confirmedAt
			: draft.activeDurationStartedAt;
	return changed({ ...cleaned, activeDurationStartedAt });
};

export const unconfirmSet = (
	draft: WorkoutEditorDraft,
	occurrenceId: string,
	setId: string,
): TimerTransition => {
	const target = getTarget(draft, occurrenceId, setId);
	if (!target) {
		return unchanged(draft, "not-found");
	}
	const occurrences = draft.occurrences.map((occurrence) =>
		occurrence.clientId !== occurrenceId
			? occurrence
			: {
					...occurrence,
					sets: occurrence.sets.map((set) =>
						set.clientId === setId
							? { ...set, included: false, confirmedAt: undefined, restTimerStartedAt: undefined }
							: set,
					),
				},
	);
	return changed(clearTargetCountdowns({ ...draft, occurrences }, occurrenceId, setId));
};

export const pauseExecution = (
	draft: WorkoutEditorDraft,
	now: number,
	expectedClientId?: string,
): TimerTransition => pauseCountdown(draft, "executionCountdown", now, expectedClientId);

export const resumeExecution = (
	draft: WorkoutEditorDraft,
	now: number,
	expectedClientId?: string,
): TimerTransition => resumeCountdown(draft, "executionCountdown", now, expectedClientId);

export const pauseRest = (
	draft: WorkoutEditorDraft,
	now: number,
	expectedClientId?: string,
): TimerTransition => pauseCountdown(draft, "restCountdown", now, expectedClientId);

export const resumeRest = (
	draft: WorkoutEditorDraft,
	now: number,
	expectedClientId?: string,
): TimerTransition => resumeCountdown(draft, "restCountdown", now, expectedClientId);

const pauseCountdown = (
	draft: WorkoutEditorDraft,
	key: "executionCountdown" | "restCountdown",
	now: number,
	expectedClientId?: string,
): TimerTransition => {
	const countdown = draft[key];
	if (
		!countdown ||
		countdown.pausedRemainingSeconds !== undefined ||
		(expectedClientId !== undefined && countdown.clientId !== expectedClientId) ||
		!Number.isFinite(now)
	) {
		return unchanged(draft);
	}
	const remaining = Math.max(0, (Date.parse(countdown.deadline) - now) / 1000);
	if (remaining === 0) {
		return unchanged(draft);
	}
	return changed({ ...draft, [key]: { ...countdown, pausedRemainingSeconds: remaining } });
};

const resumeCountdown = (
	draft: WorkoutEditorDraft,
	key: "executionCountdown" | "restCountdown",
	now: number,
	expectedClientId?: string,
): TimerTransition => {
	const countdown = draft[key];
	if (
		countdown?.pausedRemainingSeconds === undefined ||
		(expectedClientId !== undefined && countdown.clientId !== expectedClientId) ||
		!Number.isFinite(now) ||
		countdown.pausedRemainingSeconds > (8.64e15 - now) / 1000
	) {
		return unchanged(draft);
	}
	const deadline = isoAt(now + countdown.pausedRemainingSeconds * 1000);
	if (deadline === undefined) {
		return unchanged(draft, "invalid");
	}
	const { pausedRemainingSeconds: _, ...resumed } = countdown;
	return changed({ ...draft, [key]: { ...resumed, deadline } });
};

export const pauseWorkout = (draft: WorkoutEditorDraft, now: number): TimerTransition => {
	if (
		draft.mode.kind !== "live" ||
		draft.activeDurationStartedAt === undefined ||
		!Number.isFinite(now)
	) {
		return unchanged(draft);
	}
	const elapsed = Math.max(0, (now - Date.parse(draft.activeDurationStartedAt)) / 1000);
	return changed({
		...draft,
		activeDurationStartedAt: undefined,
		activeDuration: (draft.activeDuration ?? 0) + elapsed,
	});
};

export const resumeWorkout = (draft: WorkoutEditorDraft, now: number): TimerTransition => {
	const startedAt = isoAt(now);
	if (
		draft.mode.kind !== "live" ||
		draft.activeDurationStartedAt !== undefined ||
		draft.endedAt !== undefined ||
		startedAt === undefined
	) {
		return unchanged(draft);
	}
	return changed({ ...draft, activeDurationStartedAt: startedAt });
};

export const resumeStopwatch = (draft: WorkoutEditorDraft, now: number): TimerTransition => {
	const startedAt = isoAt(now);
	if (
		draft.mode.kind !== "live" ||
		draft.stopwatchStartedAt !== undefined ||
		startedAt === undefined
	) {
		return unchanged(draft);
	}
	return changed({ ...draft, stopwatchStartedAt: startedAt });
};

export const pauseStopwatch = (draft: WorkoutEditorDraft, now: number): TimerTransition => {
	if (
		draft.mode.kind !== "live" ||
		draft.stopwatchStartedAt === undefined ||
		!Number.isFinite(now)
	) {
		return unchanged(draft);
	}
	return changed({
		...draft,
		stopwatchStartedAt: undefined,
		pausedStopwatchSeconds:
			(draft.pausedStopwatchSeconds ?? 0) +
			Math.max(0, (now - Date.parse(draft.stopwatchStartedAt)) / 1000),
	});
};

export const resetStopwatch = (draft: WorkoutEditorDraft): TimerTransition =>
	draft.mode.kind !== "live"
		? unchanged(draft)
		: changed({ ...draft, pausedStopwatchSeconds: 0, stopwatchStartedAt: undefined });

export const reconcileWorkoutTimers = (
	draft: WorkoutEditorDraft,
	now: number,
	expected?: ExpectedCountdowns,
): TimerTransition => {
	const invalidated = invalidateWorkoutCountdowns(draft);
	let next = invalidated.draft;
	let wasChanged = invalidated.changed;
	if (next.mode.kind !== "live" || !Number.isFinite(now)) {
		return invalidated;
	}
	const execution = next.executionCountdown;
	if (
		execution !== undefined &&
		(expected === undefined || execution.clientId === expected.executionClientId) &&
		execution.pausedRemainingSeconds === undefined &&
		Date.parse(execution.deadline) <= now
	) {
		const confirmed = confirmSet(
			next,
			execution.occurrenceId,
			execution.setId,
			Date.parse(execution.deadline),
		);
		if (confirmed.kind === "changed") {
			next = confirmed.draft;
			wasChanged = true;
		} else {
			next = { ...next, executionCountdown: undefined };
			wasChanged = true;
		}
	}
	const rest = next.restCountdown;
	if (
		rest !== undefined &&
		(expected === undefined || rest.clientId === expected.restClientId) &&
		rest.pausedRemainingSeconds === undefined &&
		Date.parse(rest.deadline) <= now
	) {
		next = { ...next, restCountdown: undefined };
		wasChanged = true;
	}
	return wasChanged ? changed(next) : unchanged(next);
};
