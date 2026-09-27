import type { ExerciseKind } from "../../shared/exercise-kinds";
import type {
	WorkoutEditorDisplay,
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import {
	resolveWorkoutDisplay,
	resolveWorkoutRestTime,
	type WorkoutExerciseOverrides,
	type WorkoutPreferenceSettings,
	type WorkoutRestSettings,
} from "../../shared/workout-editor-preferences";
import {
	kilogramsToPounds,
	kilometersToMiles,
	milesToKilometers,
	poundsToKilograms,
} from "../../shared/workout-units";
import { confirmSet, pauseWorkout, startRest } from "./timers";

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

export const updateOccurrence = (
	draft: WorkoutEditorDraft,
	id: string,
	change: (occurrence: WorkoutEditorOccurrence) => WorkoutEditorOccurrence,
): WorkoutEditorDraft => ({
	...draft,
	occurrences: draft.occurrences.map((occurrence) =>
		occurrence.clientId === id ? change(occurrence) : occurrence,
	),
});

export const updateSet = (
	draft: WorkoutEditorDraft,
	occurrenceId: string,
	setId: string,
	change: (set: WorkoutEditorSet) => WorkoutEditorSet,
) =>
	updateOccurrence(draft, occurrenceId, (occurrence) => ({
		...occurrence,
		sets: occurrence.sets.map((set) => (set.clientId === setId ? change(set) : set)),
	}));

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
	const previous = occurrence.display ?? {
		weightUnit: "kg",
		distanceUnit: "km",
		durationUnit: "seconds",
	};
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
			: convert(draft.caloriesBurnt, (value) => value * (unit === "kJ" ? 4.184 : 1 / 4.184)),
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
		supersets: draft.supersets.flatMap((group) => {
			const retainedOccurrenceIds = group.occurrenceIds.filter((id) => retained.has(id));
			return retainedOccurrenceIds.length < 2
				? []
				: [{ ...group, occurrenceIds: retainedOccurrenceIds }];
		}),
	};
};

export const cycleWorkoutSuperset = (draft: WorkoutEditorDraft, occurrenceId: string) => {
	const group = draft.supersets.find(({ occurrenceIds }) => occurrenceIds.includes(occurrenceId));
	if (group === undefined) {
		return occurrenceId;
	}
	const ids = draft.occurrences
		.filter(({ clientId }) => group.occurrenceIds.includes(clientId))
		.map(({ clientId }) => clientId);
	return ids[(ids.indexOf(occurrenceId) + 1) % ids.length] ?? occurrenceId;
};

export const nextWorkoutOccurrence = (draft: WorkoutEditorDraft, occurrenceId: string) => {
	const group = draft.supersets.find(({ occurrenceIds }) => occurrenceIds.includes(occurrenceId));
	const incomplete = (id: string | undefined) =>
		draft.occurrences
			.find(({ clientId }) => clientId === id)
			?.sets.some(({ included }) => !included);
	if (group === undefined && incomplete(occurrenceId)) {
		return occurrenceId;
	}
	if (group !== undefined) {
		const ids = draft.occurrences
			.filter(({ clientId }) => group.occurrenceIds.includes(clientId))
			.map(({ clientId }) => clientId);
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
	return occurrenceId;
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
	const rest = resolveWorkoutRestTime({
		lot: set.setLot,
		settings: input.settings,
		overrides: input.overrides,
		explicitSeconds: set.restChoice.kind === "explicit" ? set.restChoice.seconds : undefined,
	});
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
		return {
			...next,
			pendingRest: {
				setId: input.setId,
				seconds: rest.seconds,
				occurrenceId: input.occurrenceId,
				exerciseId: occurrence.exerciseId,
			},
		};
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
			(input.observedAt !== undefined && input.observedAt - input.now >= 1500))
	) {
		next = { ...next, restCountdown: undefined };
	}
	const target = nextWorkoutOccurrence(next, input.occurrenceId);
	return {
		...next,
		pendingRest: undefined,
		activeOccurrenceId: target,
		activeSetId: next.occurrences
			.find(({ clientId }) => clientId === target)
			?.sets.find(({ included }) => !included)?.clientId,
		occurrences: next.occurrences.map((candidateOccurrence) =>
			candidateOccurrence.clientId === target
				? Object.assign({}, candidateOccurrence, { isCollapsed: false })
				: candidateOccurrence,
		),
	};
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
	const target = nextWorkoutOccurrence(next, pending.occurrenceId);
	return {
		...next,
		pendingRest: undefined,
		activeOccurrenceId: target,
		activeSetId: next.occurrences
			.find(({ clientId }) => clientId === target)
			?.sets.find(({ included }) => !included)?.clientId,
		occurrences: next.occurrences.map((candidateOccurrence) =>
			candidateOccurrence.clientId === target
				? Object.assign({}, candidateOccurrence, { isCollapsed: false })
				: candidateOccurrence,
		),
	};
};

export const finishWorkoutDraft = (draft: WorkoutEditorDraft, now: number): WorkoutEditorDraft =>
	draft.mode.kind !== "live"
		? draft
		: {
				...pauseWorkout(draft, now).draft,
				pendingRest: undefined,
				restCountdown: undefined,
				executionCountdown: undefined,
				endedAt: new Date(now).toISOString(),
			};
