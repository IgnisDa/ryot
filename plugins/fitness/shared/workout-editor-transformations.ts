import { Schema } from "@ryot-app/plugin-kit/effect";
import type { EntityId } from "@ryot-app/plugin-kit/schema";

import type { ExerciseKind } from "./exercise-kinds";
import type {
	WorkoutEditorDraft,
	WorkoutEditorMode,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "./workout-editor-draft";
import {
	type WorkoutActiveDurationChange,
	WorkoutEditorSaveInputSchema,
	type WorkoutEditorSaveInput,
} from "./workout-editor-operations";
import {
	resolveWorkoutDisplay,
	resolveWorkoutRestTime,
	type WorkoutExerciseOverrides,
	type WorkoutRestSettings,
} from "./workout-editor-preferences";
import { normalizeWorkoutMeasurements } from "./workout-records";
import { requiredWorkoutMeasurementsByKind } from "./workout-set";
import { milesToKilometers, poundsToKilograms } from "./workout-units";

export type WorkoutEditorValidationIssue = {
	readonly code:
		| "duplicate-id"
		| "invalid-measurement"
		| "invalid-rest"
		| "invalid-rpe"
		| "invalid-superset"
		| "missing-measurement"
		| "missing-name"
		| "missing-start-time"
		| "unconfirmed-set";
	readonly occurrenceId?: string;
	readonly setId?: string;
};

const inputFields = ["reps", "weight", "duration", "distance"] as const;

const parseInput = (value: string | undefined, integer: boolean) => {
	if (value === undefined || value.trim() === "") {
		return { kind: "empty" } as const;
	}
	const number = Number(value.trim());
	return Number.isFinite(number) && number >= 0 && (!integer || Number.isSafeInteger(number))
		? ({ kind: "value", value: number } as const)
		: ({ kind: "invalid" } as const);
};

const addIssue = (
	issues: WorkoutEditorValidationIssue[],
	code: WorkoutEditorValidationIssue["code"],
	occurrenceId?: string,
	setId?: string,
) => {
	issues.push({
		code,
		...(occurrenceId === undefined ? {} : { occurrenceId }),
		...(setId === undefined ? {} : { setId }),
	});
};

const isTemplateMode = (mode: WorkoutEditorMode) =>
	mode.kind === "template-create" || mode.kind === "template-edit";

export const isMeaningfulTemplateSet = (set: WorkoutEditorSet) => {
	const hasMeasurement = inputFields.some((field) => {
		const value = set[field];
		return value !== undefined && value.trim() !== "";
	});
	const hasNote = set.note !== undefined && set.note.trim().length > 0;
	const hasRpe = set.rpe !== undefined && set.rpe.trim().length > 0;
	const hasExplicitRest =
		set.restChoice.kind === "explicit" && set.restChoice.seconds.trim().length > 0;
	return hasMeasurement || hasNote || hasRpe || hasExplicitRest;
};

export const shouldIncludeWorkoutSet = (mode: WorkoutEditorMode, set: WorkoutEditorSet) => {
	if (isTemplateMode(mode)) {
		return isMeaningfulTemplateSet(set);
	}
	return set.included;
};

export const includedWorkoutOccurrences = (draft: WorkoutEditorDraft) =>
	draft.occurrences.flatMap((occurrence) => {
		const sets = occurrence.sets.filter((set) => shouldIncludeWorkoutSet(draft.mode, set));
		return isTemplateMode(draft.mode) || sets.length > 0 ? [{ sets, occurrence }] : [];
	});

export const indexWorkoutOccurrences = (
	occurrences: ReadonlyArray<WorkoutEditorOccurrence>,
): ReadonlyArray<{ readonly clientId: string; readonly order: number }> =>
	occurrences.map(({ clientId }, order) => ({ order, clientId }));

export const validateWorkoutDraft = (
	draft: WorkoutEditorDraft,
): ReadonlyArray<WorkoutEditorValidationIssue> => {
	const issues: WorkoutEditorValidationIssue[] = [];
	const ids = new Set<string>();
	const eventIds = new Set<string>();
	const exerciseIds = new Set(draft.occurrences.map(({ clientId }) => clientId));
	const addUniqueId = (id: string) => {
		if (ids.has(id)) {
			addIssue(issues, "duplicate-id");
		}
		ids.add(id);
	};
	addUniqueId(draft.draftId);
	for (const occurrence of draft.occurrences) {
		addUniqueId(occurrence.clientId);
		for (const set of occurrence.sets) {
			addUniqueId(set.clientId);
			if (set.eventId !== undefined) {
				if (eventIds.has(set.eventId)) {
					addIssue(issues, "duplicate-id", occurrence.clientId, set.clientId);
				}
				eventIds.add(set.eventId);
			}
			if (!shouldIncludeWorkoutSet(draft.mode, set)) {
				continue;
			}
			let hasInvalidMeasurement = false;
			for (const field of inputFields) {
				const parsed = parseInput(set[field], field === "reps");
				if (parsed.kind === "invalid") {
					hasInvalidMeasurement = true;
				}
			}
			if (hasInvalidMeasurement) {
				addIssue(issues, "invalid-measurement", occurrence.clientId, set.clientId);
			}
			const rpe = parseInput(set.rpe, true);
			if (rpe.kind === "invalid" || (rpe.kind === "value" && rpe.value > 10)) {
				addIssue(issues, "invalid-rpe", occurrence.clientId, set.clientId);
			}
			if (
				set.restChoice.kind === "explicit" &&
				parseInput(set.restChoice.seconds, true).kind !== "value"
			) {
				addIssue(issues, "invalid-rest", occurrence.clientId, set.clientId);
			}
			if (!isTemplateMode(draft.mode) && set.eventId === undefined) {
				for (const field of requiredWorkoutMeasurementsByKind[occurrence.exerciseKind]) {
					if (parseInput(set[field], field === "reps").kind !== "value") {
						addIssue(issues, "missing-measurement", occurrence.clientId, set.clientId);
					}
				}
				if (draft.mode.kind === "live" && set.confirmedAt === undefined) {
					addIssue(issues, "unconfirmed-set", occurrence.clientId, set.clientId);
				}
			}
		}
	}
	const supersetMembership = new Set<string>();
	for (const superset of draft.supersets) {
		addUniqueId(superset.clientId);
		if (
			superset.occurrenceIds.length < 2 ||
			new Set(superset.occurrenceIds).size !== superset.occurrenceIds.length ||
			superset.occurrenceIds.some((id) => {
				if (!exerciseIds.has(id) || supersetMembership.has(id)) {
					return true;
				}
				supersetMembership.add(id);
				return false;
			})
		) {
			addIssue(issues, "invalid-superset");
		}
	}
	if (draft.name.trim().length === 0) {
		addIssue(issues, "missing-name");
	}
	if (!isTemplateMode(draft.mode) && draft.startedAt === undefined) {
		addIssue(issues, "missing-start-time");
	}
	if (
		draft.caloriesBurnt !== undefined &&
		parseInput(draft.caloriesBurnt, false).kind === "invalid"
	) {
		addIssue(issues, "invalid-measurement");
	}
	return issues;
};

export const replaceWorkoutOccurrence = (
	draft: WorkoutEditorDraft,
	occurrenceId: string,
	replacement: { readonly exerciseId: EntityId; readonly exerciseKind: ExerciseKind },
) => {
	const occurrence = draft.occurrences.find(({ clientId }) => clientId === occurrenceId);
	if (!occurrence) {
		return { kind: "not-found" } as const;
	}
	if (occurrence.exerciseKind !== replacement.exerciseKind) {
		return { kind: "kind-mismatch" } as const;
	}
	return {
		kind: "replaced",
		draft: {
			...draft,
			pendingRest: draft.pendingRest?.occurrenceId === occurrenceId ? undefined : draft.pendingRest,
			restCountdown:
				draft.restCountdown?.occurrenceId === occurrenceId ? undefined : draft.restCountdown,
			executionCountdown:
				draft.executionCountdown?.occurrenceId === occurrenceId
					? undefined
					: draft.executionCountdown,
			occurrences: draft.occurrences.map((item) =>
				item.clientId === occurrenceId ? { ...item, exerciseId: replacement.exerciseId } : item,
			),
		},
	} as const;
};

export const cloneWorkoutForRepeat = (
	source: WorkoutEditorDraft,
	input: {
		readonly draftId: string;
		readonly idFor: () => string;
		readonly name: string;
		readonly sourceWorkoutId: EntityId;
		readonly startedAt: string;
	},
): WorkoutEditorDraft => {
	const occurrenceIds = new Map<string, string>();
	const occurrences = source.occurrences.map((occurrence) => {
		const clientId = input.idFor();
		occurrenceIds.set(occurrence.clientId, clientId);
		return {
			...occurrence,
			clientId,
			images: [],
			videos: [],
			isCollapsed: false,
			sourceExerciseOrder: undefined,
			sets: occurrence.sets.map((set) => ({
				...set,
				rpe: undefined,
				included: false,
				eventId: undefined,
				occurredAt: undefined,
				confirmedAt: undefined,
				clientId: input.idFor(),
				restTimerStartedAt: undefined,
			})),
		};
	});
	return {
		...source,
		images: [],
		videos: [],
		occurrences,
		name: input.name,
		activeDuration: 0,
		comment: undefined,
		endedAt: undefined,
		submission: undefined,
		pendingRest: undefined,
		activeSetId: undefined,
		draftId: input.draftId,
		caloriesBurnt: undefined,
		restCountdown: undefined,
		uploadedAssets: undefined,
		startedAt: input.startedAt,
		activeDurationIntent: "set",
		activeOccurrenceId: undefined,
		executionCountdown: undefined,
		stopwatchStartedAt: undefined,
		pausedStopwatchSeconds: undefined,
		activeDurationStartedAt: input.startedAt,
		mode: { kind: "live", source: { kind: "repeat", entityId: input.sourceWorkoutId } },
		supersets: source.supersets.map((superset) => ({
			...superset,
			clientId: input.idFor(),
			occurrenceIds: superset.occurrenceIds.flatMap((id) => {
				const mapped = occurrenceIds.get(id);
				return mapped === undefined ? [] : [mapped];
			}),
		})),
	};
};

const canonicalMeasurements = (
	set: WorkoutEditorSet,
	display: ReturnType<typeof resolveWorkoutDisplay>,
) => {
	const values: { reps?: number; weight?: number; duration?: number; distance?: number } = {};
	for (const field of inputFields) {
		const parsed = parseInput(set[field], field === "reps");
		if (parsed.kind !== "value") {
			continue;
		}
		if (field === "weight") {
			values.weight = display.weightUnit === "lb" ? poundsToKilograms(parsed.value) : parsed.value;
		} else if (field === "distance") {
			values.distance =
				display.distanceUnit === "mi" ? milesToKilometers(parsed.value) : parsed.value;
		} else if (field === "duration") {
			values.duration = display.durationUnit === "minutes" ? parsed.value * 60 : parsed.value;
		} else {
			values.reps = parsed.value;
		}
	}
	return normalizeWorkoutMeasurements(values);
};

const activeDurationAt = (draft: WorkoutEditorDraft, submittedAt: string) => {
	const runningSeconds =
		draft.mode.kind === "live" && draft.activeDurationStartedAt !== undefined
			? Math.max(0, (Date.parse(submittedAt) - Date.parse(draft.activeDurationStartedAt)) / 1000)
			: 0;
	return Math.trunc((draft.activeDuration ?? 0) + runningSeconds);
};

const activeDurationChange = (
	draft: WorkoutEditorDraft,
	submittedAt: string,
): WorkoutActiveDurationChange => {
	if (draft.activeDurationIntent === "preserve") {
		return { kind: "preserve" };
	}
	if (draft.activeDurationIntent === "clear") {
		return { kind: "clear" };
	}
	return { kind: "set", seconds: activeDurationAt(draft, submittedAt) };
};

export const buildWorkoutEditorSaveInput = (
	draft: WorkoutEditorDraft,
	input: { readonly submissionId: string; readonly submittedAt: string },
	context: {
		readonly exerciseOverridesById: Readonly<Record<string, WorkoutExerciseOverrides>>;
		readonly restSettings: WorkoutRestSettings;
		readonly unitSystem: "metric" | "imperial";
	},
): {
	readonly issues: ReadonlyArray<WorkoutEditorValidationIssue>;
	readonly input?: WorkoutEditorSaveInput;
} => {
	if (draft.submission !== undefined) {
		return { issues: [], input: draft.submission };
	}
	const issues = validateWorkoutDraft(draft);
	if (issues.length > 0) {
		return { issues };
	}
	const occurrences = includedWorkoutOccurrences(draft);
	const includedOccurrenceIds = new Set(occurrences.map(({ occurrence }) => occurrence.clientId));
	const supersets = draft.supersets.flatMap(({ color, occurrenceIds }) => {
		const includedIds = occurrenceIds.filter((id) => includedOccurrenceIds.has(id));
		return includedIds.length < 2 ? [] : [{ color, occurrenceIds: includedIds }];
	});
	const displayForOccurrence = (occurrence: WorkoutEditorOccurrence) =>
		resolveWorkoutDisplay({
			occurrence: occurrence.display,
			unitSystem: context.unitSystem,
			exerciseDurationUnit:
				context.exerciseOverridesById[occurrence.exerciseId]?.defaultDurationUnit,
		});
	const data = isTemplateMode(draft.mode)
		? {
				supersets,
				videos: draft.videos,
				images: draft.images,
				comment: draft.comment,
				name: draft.name.trim(),
				kind: "template" as const,
				target:
					draft.mode.kind === "template-edit"
						? {
								kind: "update" as const,
								entityId: draft.mode.entityId,
								conflictToken: draft.mode.conflictToken,
							}
						: { kind: "create" as const },
				occurrences: occurrences.map(({ sets, occurrence }) => ({
					notes: occurrence.notes,
					videos: occurrence.videos,
					images: occurrence.images,
					clientId: occurrence.clientId,
					exerciseId: occurrence.exerciseId,
					sourceExerciseOrder: occurrence.sourceExerciseOrder,
					sets: sets.map((set) => {
						const measurements = canonicalMeasurements(set, displayForOccurrence(occurrence));
						const restTime =
							set.restChoice.kind === "explicit"
								? Number(set.restChoice.seconds.trim())
								: undefined;
						return Object.assign(
							{ measurements, setLot: set.setLot, clientId: set.clientId },
							set.note === undefined ? {} : { note: set.note },
							restTime === undefined ? {} : { restTime },
							set.rpe === undefined || set.rpe.trim() === "" ? {} : { rpe: Number(set.rpe.trim()) },
						);
					}),
				})),
			}
		: {
				supersets,
				videos: draft.videos,
				images: draft.images,
				comment: draft.comment,
				endedAt: draft.endedAt,
				name: draft.name.trim(),
				kind: "workout" as const,
				startedAt: draft.startedAt,
				activeDuration: activeDurationChange(draft, input.submittedAt),
				caloriesBurnt:
					draft.caloriesBurnt === undefined || draft.caloriesBurnt.trim() === ""
						? undefined
						: Number(draft.caloriesBurnt.trim()) / (draft.displayEnergyUnit === "kJ" ? 4.184 : 1),
				target:
					draft.mode.kind === "historical"
						? {
								kind: "update" as const,
								entityId: draft.mode.entityId,
								conflictToken: draft.mode.conflictToken,
							}
						: {
								kind: "create" as const,
								...(draft.mode.source?.kind === "repeat"
									? { repeatedFromId: draft.mode.source.entityId }
									: {}),
								...(draft.mode.source?.kind === "template"
									? { templateId: draft.mode.source.entityId }
									: {}),
							},
				occurrences: occurrences.map(({ sets, occurrence }) => ({
					notes: occurrence.notes,
					images: occurrence.images,
					videos: occurrence.videos,
					clientId: occurrence.clientId,
					exerciseId: occurrence.exerciseId,
					sourceExerciseOrder: occurrence.sourceExerciseOrder,
					sets: sets.map((set) => {
						const measurements = canonicalMeasurements(set, displayForOccurrence(occurrence));
						const rest = resolveWorkoutRestTime({
							lot: set.setLot,
							settings: context.restSettings,
							overrides: context.exerciseOverridesById[occurrence.exerciseId] ?? {},
							explicitSeconds:
								set.restChoice.kind === "explicit" ? set.restChoice.seconds : undefined,
						});
						const rpe = parseInput(set.rpe, true);
						return {
							measurements,
							setLot: set.setLot,
							clientId: set.clientId,
							exerciseKind: set.exerciseKind,
							...(set.note === undefined ? {} : { note: set.note }),
							restTime: rest.kind === "resolved" ? rest.seconds : undefined,
							...(set.eventId === undefined ? {} : { eventId: set.eventId }),
							occurredAt: set.occurredAt ?? set.confirmedAt ?? draft.startedAt,
							...(set.confirmedAt === undefined ? {} : { confirmedAt: set.confirmedAt }),
							...(set.restTimerStartedAt === undefined
								? {}
								: { restTimerStartedAt: set.restTimerStartedAt }),
							...(rpe.kind === "value" ? { rpe: rpe.value } : {}),
						};
					}),
				})),
			};
	const decoded = Schema.decodeResult(Schema.fromJsonString(WorkoutEditorSaveInputSchema))(
		JSON.stringify({
			data: { ...data },
			submittedAt: input.submittedAt,
			submissionId: input.submissionId,
		}),
	);
	if (decoded._tag === "Success") {
		return { issues: [], input: decoded.success };
	}
	return { issues: [{ code: "invalid-measurement" }] };
};
