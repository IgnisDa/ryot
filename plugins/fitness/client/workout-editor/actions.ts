import type { ExerciseKind } from "../../shared/exercise-kinds";
import type {
	WorkoutEditorDisplay,
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import {
	resolveWorkoutDisplay,
	type WorkoutExerciseOverrides,
	type WorkoutPreferenceSettings,
	type WorkoutRestSettings,
} from "../../shared/workout-editor-preferences";
import { requiredWorkoutMeasurementsByKind } from "../../shared/workout-set";
import {
	energyToKilocalories,
	kilocaloriesToEnergy,
	kilogramsToPounds,
	kilometersToMiles,
	milesToKilometers,
	poundsToKilograms,
} from "../../shared/workout-units";
import { toIso } from "./clock";
import {
	focusOccurrence,
	occurrenceDisplay,
	pruneSupersets,
	resolveSetRestTime,
	supersetOf,
	supersetOrderedIds,
	updateOccurrence,
	updateSet,
} from "./draft-ops";
import {
	confirmSet,
	invalidateWorkoutCountdowns,
	pauseWorkout,
	startRest,
	unconfirmSet,
} from "./timers";

export const emptyWorkoutDraft = (input: {
	readonly id: string;
	readonly now: string;
	readonly template?: boolean;
	readonly settings: WorkoutPreferenceSettings;
}): WorkoutEditorDraft => ({
	images: [],
	videos: [],
	supersets: [],
	occurrences: [],
	draftId: input.id,
	kind: "fitness-workout-editor",
	displayEnergyUnit: input.settings.energyUnit,
	name: input.template ? "New template" : "New workout",
	activeDurationIntent: input.template ? "preserve" : "set",
	mode: { kind: input.template ? "template-create" : "live" },
	...(input.template
		? {}
		: { activeDuration: 0, startedAt: input.now, activeDurationStartedAt: input.now }),
});

export const newWorkoutSet = (
	id: string,
	kind: ExerciseKind,
	previous?: WorkoutEditorSet,
): WorkoutEditorSet => ({
	clientId: id,
	included: false,
	setLot: "normal",
	exerciseKind: kind,
	restChoice: { kind: "inherited" },
	...(previous === undefined
		? {}
		: {
				reps: previous.reps,
				weight: previous.weight,
				duration: previous.duration,
				distance: previous.distance,
			}),
});

export const editSet = (
	draft: WorkoutEditorDraft,
	occurrenceId: string,
	setId: string,
	change: (set: WorkoutEditorSet) => WorkoutEditorSet,
) => {
	const next = updateSet(draft, occurrenceId, setId, change);
	const set = next.occurrences
		.find(({ clientId }) => clientId === occurrenceId)
		?.sets.find(({ clientId }) => clientId === setId);
	return draft.mode.kind === "live" &&
		set?.included &&
		requiredWorkoutMeasurementsByKind[set.exerciseKind].some((field) => !set[field]?.trim())
		? unconfirmSet(next, occurrenceId, setId).draft
		: next;
};

const convert = (text: string | undefined, factor: (number: number) => number) => {
	if (text === undefined || text.trim() === "" || !Number.isFinite(Number(text))) {
		return text;
	}
	return String(Number(factor(Number(text)).toPrecision(12)));
};

export const changeOccurrenceDisplay = (
	occurrence: WorkoutEditorOccurrence,
	display: WorkoutEditorDisplay,
): WorkoutEditorOccurrence => {
	const previous = occurrenceDisplay(occurrence);
	return {
		...occurrence,
		display,
		sets: occurrence.sets.map((set) => ({
			...set,
			weight:
				previous.weightUnit === display.weightUnit
					? set.weight
					: convert(
							set.weight,
							display.weightUnit === "kg" ? poundsToKilograms : kilogramsToPounds,
						),
			distance:
				previous.distanceUnit === display.distanceUnit
					? set.distance
					: convert(
							set.distance,
							display.distanceUnit === "km" ? milesToKilometers : kilometersToMiles,
						),
			duration:
				previous.durationUnit === display.durationUnit
					? set.duration
					: convert(
							set.duration,
							(value) => value * (display.durationUnit === "seconds" ? 60 : 1 / 60),
						),
		})),
	};
};

export const changeWorkoutEnergyUnit = (
	draft: WorkoutEditorDraft,
	unit: WorkoutEditorDraft["displayEnergyUnit"],
): WorkoutEditorDraft => ({
	...draft,
	displayEnergyUnit: unit,
	caloriesBurnt:
		draft.displayEnergyUnit === unit
			? draft.caloriesBurnt
			: convert(draft.caloriesBurnt, (value) =>
					kilocaloriesToEnergy(energyToKilocalories(value, draft.displayEnergyUnit), unit),
				),
});

export const newWorkoutOccurrence = (input: {
	readonly id: string;
	readonly setId: string;
	readonly exerciseId: WorkoutEditorOccurrence["exerciseId"];
	readonly kind: ExerciseKind;
	readonly settings: WorkoutPreferenceSettings;
	readonly overrides: WorkoutExerciseOverrides;
}): WorkoutEditorOccurrence => ({
	notes: [],
	images: [],
	videos: [],
	clientId: input.id,
	isCollapsed: false,
	exerciseKind: input.kind,
	exerciseId: input.exerciseId,
	sets: [newWorkoutSet(input.setId, input.kind)],
	display: resolveWorkoutDisplay({
		unitSystem: input.settings.unitSystem,
		exerciseDurationUnit: input.overrides.defaultDurationUnit,
	}),
});

export const removeWorkoutItems = (
	draft: WorkoutEditorDraft,
	occurrenceIds: readonly string[],
	setIds: readonly string[],
): WorkoutEditorDraft => {
	const occurrences = draft.occurrences
		.filter(({ clientId }) => !occurrenceIds.includes(clientId))
		.map((occurrence) =>
			Object.assign({}, occurrence, {
				sets: occurrence.sets.filter(({ clientId }) => !setIds.includes(clientId)),
			}),
		);
	const retained = new Set(occurrences.map(({ clientId }) => clientId));
	return {
		...draft,
		occurrences,
		supersets: pruneSupersets(draft.supersets, (id) => retained.has(id)),
	};
};

export const cycleWorkoutSuperset = (draft: WorkoutEditorDraft, occurrenceId: string) => {
	const group = supersetOf(draft, occurrenceId);
	if (group === undefined) {
		return occurrenceId;
	}
	const ids = supersetOrderedIds(draft, group);
	return ids[(ids.indexOf(occurrenceId) + 1) % ids.length] ?? occurrenceId;
};

export const nextWorkoutOccurrence = (draft: WorkoutEditorDraft, occurrenceId: string) => {
	const group = supersetOf(draft, occurrenceId);
	const incomplete = (id: string | undefined) =>
		draft.occurrences
			.find(({ clientId }) => clientId === id)
			?.sets.some(({ included }) => !included);
	if (group === undefined && incomplete(occurrenceId)) {
		return occurrenceId;
	}
	if (group !== undefined) {
		const ids = supersetOrderedIds(draft, group);
		const start = ids.indexOf(occurrenceId);
		for (let offset = 1; offset <= ids.length; offset += 1) {
			const id = ids[(start + offset) % ids.length];
			if (id !== undefined && incomplete(id)) {
				return id;
			}
		}
	}
	const start = draft.occurrences.findIndex(({ clientId }) => clientId === occurrenceId);
	for (let offset = 1; offset <= draft.occurrences.length; offset += 1) {
		const occurrence = draft.occurrences[(start + offset) % draft.occurrences.length];
		if (occurrence !== undefined && incomplete(occurrence.clientId)) {
			return occurrence.clientId;
		}
	}
	return undefined;
};

export const workoutProgressTarget = (draft: WorkoutEditorDraft) => {
	if (draft.mode.kind !== "live") {
		return undefined;
	}
	const active = draft.occurrences.find(({ clientId }) => clientId === draft.activeOccurrenceId);
	const occurrence = active?.sets.some(({ included }) => !included)
		? active
		: draft.occurrences.find(({ sets }) => sets.some(({ included }) => !included));
	const set =
		occurrence?.sets.find(
			({ clientId, included }) => clientId === draft.activeSetId && !included,
		) ?? occurrence?.sets.find(({ included }) => !included);
	return occurrence === undefined || set === undefined ? undefined : { set, occurrence };
};

const advanceWorkout = (draft: WorkoutEditorDraft, occurrenceId: string): WorkoutEditorDraft => {
	const target = nextWorkoutOccurrence(draft, occurrenceId);
	const focused = focusOccurrence(
		draft,
		target,
		draft.occurrences
			.find(({ clientId }) => clientId === target)
			?.sets.find(({ included }) => !included)?.clientId,
	);
	return updateOccurrence(focused, occurrenceId, (occurrence) =>
		occurrence.sets.length > 0 && occurrence.sets.every(({ included }) => included)
			? { ...occurrence, isCollapsed: true }
			: occurrence,
	);
};

export const completeWorkoutSet = (
	draft: WorkoutEditorDraft,
	input: {
		readonly occurrenceId: string;
		readonly setId: string;
		readonly now: number;
		readonly observedAt?: number;
		readonly timerId: string;
		readonly prompt: boolean;
		readonly settings: Partial<WorkoutRestSettings>;
		readonly overrides: WorkoutExerciseOverrides;
	},
): WorkoutEditorDraft => {
	const occurrence = draft.occurrences.find(({ clientId }) => clientId === input.occurrenceId);
	const set = occurrence?.sets.find(({ clientId }) => clientId === input.setId);
	if (occurrence === undefined || set === undefined || set.included) {
		return draft;
	}
	const rest = resolveSetRestTime(set, input.settings, input.overrides);
	if (rest.kind !== "resolved") {
		return draft;
	}
	const confirmed = confirmSet(draft, input.occurrenceId, input.setId, input.now);
	if (!confirmed.changed) {
		return draft;
	}
	let next = updateSet(confirmed.draft, input.occurrenceId, input.setId, (currentSet) => ({
		...currentSet,
		restChoice: { kind: "explicit", seconds: String(rest.seconds) },
	}));
	if (input.prompt && rest.seconds > 0) {
		return advanceWorkout(
			{
				...next,
				pendingRest: {
					setId: input.setId,
					seconds: rest.seconds,
					occurrenceId: input.occurrenceId,
					exerciseId: occurrence.exerciseId,
				},
			},
			input.occurrenceId,
		);
	}
	next = startRest(
		next,
		input.occurrenceId,
		input.setId,
		rest.seconds,
		input.now,
		input.timerId,
	).draft;
	if (
		next.restCountdown !== undefined &&
		(Date.parse(next.restCountdown.deadline) <= (input.observedAt ?? input.now) ||
			(input.observedAt !== undefined &&
				input.observedAt - input.now >= COUNTDOWN_FEEDBACK_WINDOW_MS))
	) {
		next = { ...next, restCountdown: undefined };
	}
	return advanceWorkout({ ...next, pendingRest: undefined }, input.occurrenceId);
};

export type ExpectedCountdowns = {
	readonly executionClientId?: string;
	readonly restClientId?: string;
};

export const COUNTDOWN_FEEDBACK_WINDOW_MS = 1500;

export const reconcileWorkoutTimers = (
	draft: WorkoutEditorDraft,
	now: number,
	input: {
		readonly settings: Partial<WorkoutRestSettings>;
		readonly prompt: boolean;
		readonly expected?: ExpectedCountdowns | undefined;
	},
) => {
	let next = invalidateWorkoutCountdowns(draft).draft;
	let feedback = false;
	if (next.mode.kind === "live" && Number.isFinite(now)) {
		const execution = next.executionCountdown;
		const rest = next.restCountdown;
		const restExpired =
			rest !== undefined &&
			(input.expected === undefined || rest.clientId === input.expected.restClientId) &&
			rest.pausedRemainingSeconds === undefined &&
			Date.parse(rest.deadline) <= now;
		if (
			execution !== undefined &&
			(input.expected === undefined || execution.clientId === input.expected.executionClientId) &&
			execution.pausedRemainingSeconds === undefined &&
			Date.parse(execution.deadline) <= now
		) {
			const deadline = Date.parse(execution.deadline);
			const completed = completeWorkoutSet(next, {
				overrides: {},
				now: deadline,
				observedAt: now,
				prompt: input.prompt,
				setId: execution.setId,
				settings: input.settings,
				occurrenceId: execution.occurrenceId,
				timerId: `${execution.clientId}:rest`,
			});
			feedback = completed !== next && now - deadline < COUNTDOWN_FEEDBACK_WINDOW_MS;
			next = completed === next ? { ...next, executionCountdown: undefined } : completed;
		}
		if (restExpired) {
			if (next.restCountdown === rest) {
				next = { ...next, restCountdown: undefined };
			}
			feedback ||= now - Date.parse(rest.deadline) < COUNTDOWN_FEEDBACK_WINDOW_MS;
		}
	}
	return { feedback, draft: next, changed: next !== draft };
};

export const resolvePendingRest = (
	draft: WorkoutEditorDraft,
	now: number,
	id: string,
	skip: boolean,
) => {
	const pending = draft.pendingRest;
	if (pending === undefined) {
		return draft;
	}
	const next = skip
		? draft
		: startRest(draft, pending.occurrenceId, pending.setId, pending.seconds, now, id).draft;
	return { ...next, pendingRest: undefined };
};

export const finishWorkoutDraft = (draft: WorkoutEditorDraft, now: number): WorkoutEditorDraft =>
	draft.mode.kind !== "live"
		? draft
		: {
				...pauseWorkout(draft, now).draft,
				endedAt: toIso(now),
				pendingRest: undefined,
				restCountdown: undefined,
				executionCountdown: undefined,
			};
