import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "./exercise-kinds";
import { ExerciseNotesSchema } from "./workout-details-recipes";
import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "./workout-editor-draft";
import { WorkoutEditorDraftSchema } from "./workout-editor-draft";
import {
	encodeWorkoutEditorBaseline,
	type WorkoutEditorBaseline,
	type WorkoutEditorExercise,
	type WorkoutEditorEvent,
} from "./workout-editor-recipes";
import { cloneWorkoutForRepeat } from "./workout-editor-transformations";
import { WorkoutEditorMediaSchema, WorkoutSetLotSchema } from "./workout-set";

const nonNegativeInteger = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const timestamp = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) => Number.isFinite(Date.parse(value)) || "Expected a valid timestamp",
		),
	),
);
const nullableString = Schema.NullOr(Schema.String);
const nullableMeasurement = Schema.NullOr(Schema.Finite);
const optionalNullableMeasurement = Schema.optional(nullableMeasurement);
const optionalNullableString = Schema.optional(nullableString);
const optionalNullableMedia = Schema.optional(Schema.NullOr(WorkoutEditorMediaSchema));
const optionalNullableRest = Schema.optional(Schema.NullOr(nonNegativeInteger));
const optionalNullableRpe = Schema.optional(
	Schema.NullOr(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 10 })))),
);

const WorkoutEditorSourceSupersetSchema = Schema.Struct({
	color: Schema.String,
	exercises: Schema.Array(nonNegativeInteger),
});

const WorkoutEditorWorkoutPropertiesSchema = Schema.Struct({
	startedAt: timestamp,
	images: optionalNullableMedia,
	videos: optionalNullableMedia,
	activeDuration: optionalNullableRest,
	endedAt: Schema.optional(nullableString),
	comment: Schema.optional(nullableString),
	caloriesBurnt: optionalNullableMeasurement,
	exerciseNotes: Schema.optional(Schema.NullOr(ExerciseNotesSchema)),
	supersets: Schema.optional(Schema.NullOr(Schema.Array(WorkoutEditorSourceSupersetSchema))),
});

const WorkoutEditorTemplateSetPropertiesSchema = Schema.Struct({
	rpe: optionalNullableRpe,
	setLot: WorkoutSetLotSchema,
	setOrder: nonNegativeInteger,
	note: optionalNullableString,
	restTime: optionalNullableRest,
	reps: optionalNullableMeasurement,
	weight: optionalNullableMeasurement,
	duration: optionalNullableMeasurement,
	distance: optionalNullableMeasurement,
});

const WorkoutEditorTemplateOccurrencePropertiesSchema = Schema.Struct({
	exerciseId: EntityId,
	images: optionalNullableMedia,
	videos: optionalNullableMedia,
	exerciseOrder: nonNegativeInteger,
	notes: Schema.Array(Schema.String),
	sets: Schema.Array(WorkoutEditorTemplateSetPropertiesSchema),
});

const WorkoutEditorTemplatePropertiesSchema = Schema.Struct({
	images: optionalNullableMedia,
	videos: optionalNullableMedia,
	comment: Schema.optional(nullableString),
	exercises: Schema.Array(WorkoutEditorTemplateOccurrencePropertiesSchema),
	supersets: Schema.optional(Schema.NullOr(Schema.Array(WorkoutEditorSourceSupersetSchema))),
});

const WorkoutEditorWorkoutSetPropertiesSchema = Schema.Struct({
	rpe: optionalNullableRpe,
	setLot: WorkoutSetLotSchema,
	setOrder: nonNegativeInteger,
	note: optionalNullableString,
	images: optionalNullableMedia,
	videos: optionalNullableMedia,
	restTime: optionalNullableRest,
	exerciseKind: exerciseKindSchema,
	exerciseOrder: nonNegativeInteger,
	reps: optionalNullableMeasurement,
	weight: optionalNullableMeasurement,
	confirmedAt: optionalNullableString,
	duration: optionalNullableMeasurement,
	distance: optionalNullableMeasurement,
	restTimerStartedAt: optionalNullableString,
});

type SourceBlocker = {
	readonly exerciseId: string;
	readonly code: "missing-exercise" | "invalid-record";
};

export type WorkoutEditorSourceHydration =
	| { readonly kind: "ready"; readonly draft: WorkoutEditorDraft }
	| {
			readonly kind: "blocked";
			readonly baseline: WorkoutEditorBaseline;
			readonly blockers: ReadonlyArray<SourceBlocker>;
	  };

const valid = <A>(schema: Schema.Codec<A, unknown>, value: unknown): A | undefined => {
	const result = Schema.decodeUnknownResult(schema)(value);
	return result._tag === "Success" ? result.success : undefined;
};

const measuredStrings = (source: {
	readonly reps?: number | null | undefined;
	readonly weight?: number | null | undefined;
	readonly duration?: number | null | undefined;
	readonly distance?: number | null | undefined;
}) => ({
	reps: asMeasurement(source.reps),
	weight: asMeasurement(source.weight),
	duration: asMeasurement(source.duration),
	distance: asMeasurement(source.distance),
});

const asMeasurement = (value: number | null | undefined) =>
	value !== null && value !== undefined && Number.isFinite(value) ? String(value) : undefined;

const sourceOccurrenceId = (entityId: string, order: number) =>
	`source:${encodeURIComponent(entityId)}:${order}`;

const sourceSetId = (entityId: string, order: number, setOrder: number) =>
	`${sourceOccurrenceId(entityId, order)}:set:${setOrder}`;

const makeSet = (
	clientId: string,
	exerciseKind: WorkoutEditorSet["exerciseKind"],
	values: Partial<WorkoutEditorSet>,
): WorkoutEditorSet => ({
	clientId,
	exerciseKind,
	images: values.images ?? [],
	videos: values.videos ?? [],
	setLot: values.setLot ?? "normal",
	included: values.included ?? false,
	restChoice: values.restChoice ?? { kind: "inherited" },
	...values,
});

const makeOccurrence = (
	clientId: string,
	exerciseId: EntityId,
	exerciseKind: WorkoutEditorOccurrence["exerciseKind"],
	values: Partial<WorkoutEditorOccurrence>,
): WorkoutEditorOccurrence => ({
	clientId,
	sets: [],
	notes: [],
	exerciseId,
	images: [],
	videos: [],
	exerciseKind,
	isCollapsed: false,
	...values,
});

const sourceSupersets = (
	baseline: WorkoutEditorBaseline,
	value: unknown,
	occurrences: ReadonlyArray<WorkoutEditorOccurrence>,
): { readonly supersets: WorkoutEditorDraft["supersets"]; readonly blocker?: SourceBlocker } => {
	if (value === undefined || value === null) {
		return { supersets: [] };
	}
	const decoded = valid(Schema.Array(WorkoutEditorSourceSupersetSchema), value);
	if (decoded === undefined) {
		return { supersets: [], blocker: { code: "invalid-record", exerciseId: baseline.entity.id } };
	}
	const supersets = decoded.map(({ color, exercises }, index) => ({
		color,
		clientId: `source:${encodeURIComponent(baseline.entity.id)}:superset:${index}`,
		occurrenceIds: exercises.flatMap((order) => {
			const occurrence = occurrences.find(
				({ sourceExerciseOrder }) => sourceExerciseOrder === order,
			);
			return occurrence === undefined ? [] : [occurrence.clientId];
		}),
	}));
	const invalidIndex = decoded.some(({ exercises }) =>
		exercises.some(
			(order) => !occurrences.some(({ sourceExerciseOrder }) => sourceExerciseOrder === order),
		),
	);
	return {
		supersets,
		...(invalidIndex
			? { blocker: { exerciseId: baseline.entity.id, code: "invalid-record" as const } }
			: {}),
	};
};

const blockerResult = (
	baseline: WorkoutEditorBaseline,
	blockers: ReadonlyArray<SourceBlocker>,
): WorkoutEditorSourceHydration => ({ baseline, blockers, kind: "blocked" });

const workoutDraft = (
	baseline: WorkoutEditorBaseline,
	exercises: readonly WorkoutEditorExercise[],
	draftId: string,
): WorkoutEditorSourceHydration => {
	const blockers: SourceBlocker[] = [];
	const properties = valid(WorkoutEditorWorkoutPropertiesSchema, baseline.entity.properties);
	if (properties === undefined) {
		return blockerResult(baseline, [{ code: "invalid-record", exerciseId: baseline.entity.id }]);
	}
	const exercisesById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
	const groups = new Map<
		number,
		{
			exerciseId: EntityId;
			sets: Array<{
				event: WorkoutEditorEvent;
				properties: typeof WorkoutEditorWorkoutSetPropertiesSchema.Type;
			}>;
		}
	>();
	for (const event of baseline.sets) {
		const setProperties = valid(WorkoutEditorWorkoutSetPropertiesSchema, event.properties);
		if (
			event.sessionEntityId !== baseline.entity.id ||
			!Number.isFinite(Date.parse(event.occurredAt)) ||
			setProperties === undefined
		) {
			blockers.push({ code: "invalid-record", exerciseId: event.entityId });
			continue;
		}
		if (!exercisesById.has(event.entityId)) {
			blockers.push({ code: "missing-exercise", exerciseId: event.entityId });
		}
		const group = groups.get(setProperties.exerciseOrder);
		if (group !== undefined && group.exerciseId !== event.entityId) {
			blockers.push({ code: "invalid-record", exerciseId: event.entityId });
			continue;
		}
		const next = group ?? { sets: [], exerciseId: event.entityId };
		next.sets.push({ event, properties: setProperties });
		groups.set(setProperties.exerciseOrder, next);
	}
	const orderedGroups = [...groups.entries()].sort(([left], [right]) => left - right);
	const occurrences = orderedGroups.flatMap(([order, group]) => {
		const providerExercise = exercisesById.get(group.exerciseId);
		if (providerExercise === undefined) {
			return [];
		}
		const orderedSets = [...group.sets].sort(
			(left, right) =>
				left.properties.setOrder - right.properties.setOrder ||
				left.event.id.localeCompare(right.event.id),
		);
		const firstSet = orderedSets[0];
		if (firstSet === undefined) {
			blockers.push({ code: "invalid-record", exerciseId: group.exerciseId });
			return [];
		}
		const occurrenceId = sourceOccurrenceId(baseline.entity.id, order);
		const exerciseNotes = properties.exerciseNotes?.find(
			(item) => item.exerciseOrder === order,
		)?.notes;
		return [
			makeOccurrence(occurrenceId, group.exerciseId, firstSet.properties.exerciseKind, {
				sourceExerciseOrder: order,
				notes: exerciseNotes ?? [],
				display: { weightUnit: "kg", distanceUnit: "km", durationUnit: "seconds" },
				sets: orderedSets.map(({ event, properties: set }) =>
					makeSet(event.id, set.exerciseKind, {
						included: true,
						setLot: set.setLot,
						...measuredStrings(set),
						eventId: event.id,
						images: set.images ?? [],
						videos: set.videos ?? [],
						note: set.note ?? undefined,
						occurredAt: event.occurredAt,
						confirmedAt: set.confirmedAt ?? undefined,
						restTimerStartedAt: set.restTimerStartedAt ?? undefined,
						rpe: set.rpe === undefined || set.rpe === null ? undefined : String(set.rpe),
						restChoice:
							set.restTime === undefined || set.restTime === null
								? { kind: "inherited" }
								: { kind: "explicit", seconds: String(set.restTime) },
					}),
				),
			}),
		];
	});
	const supersetResult = sourceSupersets(baseline, properties.supersets, occurrences);
	if (supersetResult.blocker !== undefined) {
		blockers.push(supersetResult.blocker);
	}
	if (blockers.length > 0) {
		return blockerResult(baseline, blockers);
	}
	const decoded = valid(WorkoutEditorDraftSchema, {
		draftId,
		occurrences,
		displayEnergyUnit: "kcal",
		name: baseline.entity.name,
		kind: "fitness-workout-editor",
		images: properties.images ?? [],
		videos: properties.videos ?? [],
		startedAt: properties.startedAt,
		activeDurationIntent: "preserve",
		supersets: supersetResult.supersets,
		endedAt: properties.endedAt ?? undefined,
		comment: properties.comment ?? undefined,
		caloriesBurnt: asMeasurement(properties.caloriesBurnt),
		activeDuration: properties.activeDuration ?? undefined,
		mode: {
			kind: "historical",
			entityId: baseline.entity.id,
			conflictToken: encodeWorkoutEditorBaseline(baseline),
		},
	});
	return decoded === undefined
		? blockerResult(baseline, [{ code: "invalid-record", exerciseId: baseline.entity.id }])
		: { kind: "ready", draft: decoded };
};

const templateDraft = (
	baseline: WorkoutEditorBaseline,
	exercises: readonly WorkoutEditorExercise[],
	draftId: string,
): WorkoutEditorSourceHydration => {
	const blockers: SourceBlocker[] = [];
	const properties = valid(WorkoutEditorTemplatePropertiesSchema, baseline.entity.properties);
	if (properties === undefined) {
		return blockerResult(baseline, [{ code: "invalid-record", exerciseId: baseline.entity.id }]);
	}
	const exercisesById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
	const orderedSources = [...properties.exercises].sort(
		(left, right) => left.exerciseOrder - right.exerciseOrder,
	);
	const seenOrders = new Set<number>();
	const occurrences = orderedSources.flatMap((source) => {
		if (seenOrders.has(source.exerciseOrder)) {
			blockers.push({ code: "invalid-record", exerciseId: source.exerciseId });
			return [];
		}
		seenOrders.add(source.exerciseOrder);
		const exercise = exercisesById.get(source.exerciseId);
		if (exercise === undefined) {
			blockers.push({ code: "missing-exercise", exerciseId: source.exerciseId });
			return [];
		}
		const exerciseKind = valid(exerciseKindSchema, exercise.properties["kind"]);
		if (exerciseKind === undefined) {
			blockers.push({ code: "invalid-record", exerciseId: source.exerciseId });
			return [];
		}
		const occurrenceId = sourceOccurrenceId(baseline.entity.id, source.exerciseOrder);
		const orderedSets = [...source.sets].sort((left, right) => left.setOrder - right.setOrder);
		if (new Set(orderedSets.map(({ setOrder }) => setOrder)).size !== orderedSets.length) {
			blockers.push({ code: "invalid-record", exerciseId: source.exerciseId });
			return [];
		}
		return [
			makeOccurrence(occurrenceId, source.exerciseId, exerciseKind, {
				notes: source.notes,
				images: source.images ?? [],
				videos: source.videos ?? [],
				sourceExerciseOrder: source.exerciseOrder,
				sets: orderedSets.map((set) =>
					makeSet(
						sourceSetId(baseline.entity.id, source.exerciseOrder, set.setOrder),
						exerciseKind,
						{
							included: false,
							setLot: set.setLot,
							...measuredStrings(set),
							note: set.note ?? undefined,
							rpe: set.rpe === undefined || set.rpe === null ? undefined : String(set.rpe),
							restChoice:
								set.restTime === undefined || set.restTime === null
									? { kind: "inherited" }
									: { kind: "explicit", seconds: String(set.restTime) },
						},
					),
				),
			}),
		];
	});
	const supersetResult = sourceSupersets(baseline, properties.supersets, occurrences);
	if (supersetResult.blocker !== undefined) {
		blockers.push(supersetResult.blocker);
	}
	if (blockers.length > 0) {
		return blockerResult(baseline, blockers);
	}
	const decoded = valid(WorkoutEditorDraftSchema, {
		draftId,
		occurrences,
		displayEnergyUnit: "kcal",
		name: baseline.entity.name,
		kind: "fitness-workout-editor",
		images: properties.images ?? [],
		videos: properties.videos ?? [],
		activeDurationIntent: "preserve",
		supersets: supersetResult.supersets,
		comment: properties.comment ?? undefined,
		mode: {
			kind: "template-edit",
			entityId: baseline.entity.id,
			conflictToken: encodeWorkoutEditorBaseline(baseline),
		},
	});
	return decoded === undefined
		? blockerResult(baseline, [{ code: "invalid-record", exerciseId: baseline.entity.id }])
		: { kind: "ready", draft: decoded };
};

export const hydrateWorkoutEditorSource = (input: {
	readonly baseline: WorkoutEditorBaseline;
	readonly exercises: readonly WorkoutEditorExercise[];
	readonly kind: "workout" | "template";
	readonly draftId: string;
}): WorkoutEditorSourceHydration =>
	input.kind === "workout"
		? workoutDraft(input.baseline, input.exercises, input.draftId)
		: templateDraft(input.baseline, input.exercises, input.draftId);

export const cloneWorkoutEditorSource = (
	source: WorkoutEditorDraft,
	input:
		| {
				readonly kind: "live";
				readonly draftId: string;
				readonly idFor: () => string;
				readonly name: string;
				readonly startedAt: string;
				readonly templateId: EntityId;
		  }
		| {
				readonly kind: "template-create";
				readonly draftId: string;
				readonly idFor: () => string;
				readonly name: string;
				readonly sourceWorkoutId: EntityId;
		  },
): WorkoutEditorDraft => {
	if (input.kind === "live") {
		const cloned = cloneWorkoutForRepeat(source, {
			name: input.name,
			idFor: input.idFor,
			draftId: input.draftId,
			startedAt: input.startedAt,
			sourceWorkoutId: input.templateId,
		});
		return {
			...cloned,
			mode: { kind: "live", source: { kind: "template", entityId: input.templateId } },
			occurrences: cloned.occurrences.map((occurrence, occurrenceIndex) =>
				Object.assign({}, occurrence, {
					sets: occurrence.sets.map((set, setIndex) =>
						Object.assign({}, set, {
							rpe: source.occurrences[occurrenceIndex]?.sets[setIndex]?.rpe,
						}),
					),
				}),
			),
		};
	}
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
				images: [],
				videos: [],
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
		comment: undefined,
		endedAt: undefined,
		startedAt: undefined,
		submission: undefined,
		draftId: input.draftId,
		caloriesBurnt: undefined,
		restCountdown: undefined,
		activeDuration: undefined,
		executionCountdown: undefined,
		stopwatchStartedAt: undefined,
		activeDurationIntent: "preserve",
		pausedStopwatchSeconds: undefined,
		activeDurationStartedAt: undefined,
		mode: { kind: "template-create", sourceWorkoutId: input.sourceWorkoutId },
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
