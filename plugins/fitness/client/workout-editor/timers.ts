import type {
	WorkoutEditorCountdownSchema,
	WorkoutEditorDraft,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import { requiredWorkoutMeasurementsByKind } from "../../shared/workout-set";
import { isoAt, maxDateMillis, toIso } from "./clock";
import { updateSet } from "./draft-ops";

type Countdown = typeof WorkoutEditorCountdownSchema.Type;
type CountdownKey = "executionCountdown" | "restCountdown";

type TimerTransition = { readonly changed: boolean; readonly draft: WorkoutEditorDraft };

type ExpectedCountdowns = { readonly executionClientId?: string; readonly restClientId?: string };

const unchanged = (draft: WorkoutEditorDraft): TimerTransition => ({ draft, changed: false });

const changed = (draft: WorkoutEditorDraft): TimerTransition => ({ draft, changed: true });

const exceedsDateRange = (seconds: number, now: number) => seconds > (maxDateMillis - now) / 1000;

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
	pendingRest:
		draft.pendingRest?.occurrenceId === occurrenceId && draft.pendingRest.setId === setId
			? undefined
			: draft.pendingRest,
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
	return Number.isFinite(parsed) &&
		parsed >= 0 &&
		(field !== "reps" || Number.isSafeInteger(parsed))
		? parsed
		: undefined;
};

export const missingMeasurements = (set: WorkoutEditorSet) =>
	requiredWorkoutMeasurementsByKind[set.exerciseKind].filter(
		(field) => parseMeasurement(set, field) === undefined,
	);

export const activeDurationSeconds = (draft: WorkoutEditorDraft, now: number) =>
	draft.activeDuration === undefined
		? undefined
		: draft.activeDuration +
			(draft.activeDurationStartedAt === undefined
				? 0
				: Math.max(0, (now - Date.parse(draft.activeDurationStartedAt)) / 1000));

export const stopwatchSeconds = (draft: WorkoutEditorDraft, now: number) =>
	(draft.pausedStopwatchSeconds ?? 0) +
	(draft.stopwatchStartedAt === undefined
		? 0
		: Math.max(0, (now - Date.parse(draft.stopwatchStartedAt)) / 1000));

export const remainingSeconds = (countdown: Countdown, now: number) =>
	Math.max(0, countdown.pausedRemainingSeconds ?? (Date.parse(countdown.deadline) - now) / 1000);

export const shiftCountdown = (
	draft: WorkoutEditorDraft,
	key: CountdownKey,
	clientId: string,
	seconds: number,
	now: number,
): WorkoutEditorDraft => {
	const current = draft[key];
	if (current === undefined || current.clientId !== clientId) {
		return draft;
	}
	return {
		...draft,
		[key]: {
			...current,
			deadline: toIso(Math.max(now, Date.parse(current.deadline) + seconds * 1000)),
			...(current.pausedRemainingSeconds === undefined
				? {}
				: { pausedRemainingSeconds: Math.max(0, current.pausedRemainingSeconds + seconds) }),
		},
	};
};

export const invalidateWorkoutCountdowns = (draft: WorkoutEditorDraft): TimerTransition => {
	const pending = draft.pendingRest;
	if (
		pending !== undefined &&
		(draft.mode.kind !== "live" ||
			getTarget(draft, pending.occurrenceId, pending.setId)?.occurrence.exerciseId !==
				pending.exerciseId ||
			!getTarget(draft, pending.occurrenceId, pending.setId)?.set.included)
	) {
		return changed(invalidateWorkoutCountdowns({ ...draft, pendingRest: undefined }).draft);
	}
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
		return unchanged(draft);
	}
	const { set, occurrence } = target;
	if (set.included || missingMeasurements(set).length > 0) {
		return unchanged(draft);
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
		exceedsDateRange(durationSeconds, now)
	) {
		return unchanged(draft);
	}
	const deadline = isoAt(now + durationSeconds * 1000);
	if (deadline === undefined) {
		return unchanged(draft);
	}
	const executionCountdown: Countdown = {
		setId,
		deadline,
		clientId: id,
		occurrenceId,
		durationSeconds,
		exerciseId: occurrence.exerciseId,
	};
	return changed({
		...draft,
		executionCountdown,
		activeSetId: setId,
		activeOccurrenceId: occurrenceId,
		occurrences: draft.occurrences.map((item) =>
			item.clientId === occurrenceId ? { ...item, isCollapsed: false } : item,
		),
	});
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
		exceedsDateRange(seconds, now)
	) {
		return unchanged(draft);
	}
	const { occurrence } = target;
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
	return changed({
		...updateSet(draft, occurrenceId, setId, (set) => ({ ...set, restTimerStartedAt: startedAt })),
		restCountdown,
	});
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
		missingMeasurements(target.set).length > 0
	) {
		return unchanged(draft);
	}
	const occurredAt = target.set.occurredAt ?? confirmedAt;
	const cleaned = clearTargetCountdowns(
		updateSet(draft, occurrenceId, setId, (set) => ({
			...set,
			occurredAt,
			confirmedAt,
			included: true,
		})),
		occurrenceId,
		setId,
	);
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
		return unchanged(draft);
	}
	return changed(
		clearTargetCountdowns(
			updateSet(draft, occurrenceId, setId, (set) => ({
				...set,
				included: false,
				confirmedAt: undefined,
				restTimerStartedAt: undefined,
			})),
			occurrenceId,
			setId,
		),
	);
};

export const pauseCountdown = (
	draft: WorkoutEditorDraft,
	key: CountdownKey,
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

export const resumeCountdown = (
	draft: WorkoutEditorDraft,
	key: CountdownKey,
	now: number,
	expectedClientId?: string,
): TimerTransition => {
	const countdown = draft[key];
	if (
		countdown?.pausedRemainingSeconds === undefined ||
		(expectedClientId !== undefined && countdown.clientId !== expectedClientId) ||
		!Number.isFinite(now) ||
		exceedsDateRange(countdown.pausedRemainingSeconds, now)
	) {
		return unchanged(draft);
	}
	const deadline = isoAt(now + countdown.pausedRemainingSeconds * 1000);
	if (deadline === undefined) {
		return unchanged(draft);
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

export const toggleStopwatch = (draft: WorkoutEditorDraft, now: number) =>
	(draft.stopwatchStartedAt === undefined ? resumeStopwatch : pauseStopwatch)(draft, now);

export const toggleWorkoutPause = (draft: WorkoutEditorDraft, now: number) =>
	(draft.activeDurationStartedAt === undefined ? resumeWorkout : pauseWorkout)(draft, now);

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
		if (confirmed.changed) {
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
