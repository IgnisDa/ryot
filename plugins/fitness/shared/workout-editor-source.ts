import { Schema } from "@ryot-app/plugin-kit/effect";
import type { EntityId } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "./exercise-kinds";
import { supersetColor } from "./superset-colors";
import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "./workout-editor-draft";
import { WorkoutEditorDraftSchema } from "./workout-editor-draft";
import {
	TemplatePropertiesSchema,
	type TemplateSetProperties,
	WorkoutPropertiesSchema,
	WorkoutSetPropertiesSchema,
	WorkoutSupersetPropertySchema,
} from "./workout-editor-properties";
import {
	encodeWorkoutEditorBaseline,
	type WorkoutEditorBaseline,
	type WorkoutEditorEvent,
	type WorkoutEditorExercise,
} from "./workout-editor-recipes";
import { storageWorkoutDisplay } from "./workout-units";

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

const measuredStrings = (
	source: Pick<TemplateSetProperties, "reps" | "weight" | "duration" | "distance">,
) => ({
	reps: asMeasurement(source.reps),
	weight: asMeasurement(source.weight),
	duration: asMeasurement(source.duration),
	distance: asMeasurement(source.distance),
});

const asMeasurement = (value: number | null | undefined) =>
	value !== null && value !== undefined && Number.isFinite(value) ? String(value) : undefined;

const restChoiceOf = (restTime: number | null | undefined): WorkoutEditorSet["restChoice"] =>
	restTime === undefined || restTime === null
		? { kind: "inherited" }
		: { kind: "explicit", seconds: String(restTime) };

const rpeInput = (rpe: number | null | undefined) =>
	rpe === undefined || rpe === null ? undefined : String(rpe);

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
	const decoded = valid(Schema.Array(WorkoutSupersetPropertySchema), value);
	if (decoded === undefined) {
		return { supersets: [], blocker: { code: "invalid-record", exerciseId: baseline.entity.id } };
	}
	const supersets = decoded.map(({ color, exercises }, index) => ({
		color: supersetColor(color),
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
	const properties = valid(WorkoutPropertiesSchema, baseline.entity.properties);
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
				properties: typeof WorkoutSetPropertiesSchema.Type;
			}>;
		}
	>();
	for (const event of baseline.sets) {
		const setProperties = valid(WorkoutSetPropertiesSchema, event.properties);
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
	const mediaOrders = new Set<number>();
	for (const media of properties.exerciseMedia ?? []) {
		if (
			mediaOrders.has(media.exerciseOrder) ||
			(!groups.has(media.exerciseOrder) && (media.images.length > 0 || media.videos.length > 0))
		) {
			blockers.push({ code: "invalid-record", exerciseId: baseline.entity.id });
			break;
		}
		mediaOrders.add(media.exerciseOrder);
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
		const exerciseMedia = properties.exerciseMedia?.find((item) => item.exerciseOrder === order);
		return [
			makeOccurrence(occurrenceId, group.exerciseId, firstSet.properties.exerciseKind, {
				sourceExerciseOrder: order,
				notes: exerciseNotes ?? [],
				display: storageWorkoutDisplay,
				images: exerciseMedia?.images ?? [],
				videos: exerciseMedia?.videos ?? [],
				sets: orderedSets.map(({ event, properties: set }) =>
					makeSet(event.id, set.exerciseKind, {
						included: true,
						setLot: set.setLot ?? "normal",
						...measuredStrings(set),
						eventId: event.id,
						rpe: rpeInput(set.rpe),
						note: set.note ?? undefined,
						occurredAt: event.occurredAt,
						restChoice: restChoiceOf(set.restTime),
						confirmedAt: set.confirmedAt ?? undefined,
						restTimerStartedAt: set.restTimerStartedAt ?? undefined,
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

export const normalizeTemplatePlan = (value: unknown) => {
	const decoded = valid(TemplatePropertiesSchema, value);
	if (decoded === undefined) {
		return undefined;
	}
	const exercises = decoded.exercises
		.map((occurrence) =>
			Object.assign({}, occurrence, {
				sets: [...occurrence.sets].sort((left, right) => left.setOrder - right.setOrder),
			}),
		)
		.sort((left, right) => left.exerciseOrder - right.exerciseOrder);
	const orders = new Set(exercises.map(({ exerciseOrder }) => exerciseOrder));
	const invalid =
		orders.size !== exercises.length ||
		exercises.some(
			({ sets, exerciseId }) =>
				exerciseId.length === 0 ||
				new Set(sets.map(({ setOrder }) => setOrder)).size !== sets.length,
		) ||
		decoded.supersets?.some(({ exercises: members }) =>
			members.some((order) => !orders.has(order)),
		);
	return invalid ? undefined : { ...decoded, exercises };
};

const templateDraft = (
	baseline: WorkoutEditorBaseline,
	exercises: readonly WorkoutEditorExercise[],
	draftId: string,
): WorkoutEditorSourceHydration => {
	const blockers: SourceBlocker[] = [];
	const properties = normalizeTemplatePlan(baseline.entity.properties);
	if (properties === undefined) {
		return blockerResult(baseline, [{ code: "invalid-record", exerciseId: baseline.entity.id }]);
	}
	const exercisesById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
	const occurrences = properties.exercises.flatMap((source) => {
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
		return [
			makeOccurrence(occurrenceId, source.exerciseId, exerciseKind, {
				notes: source.notes,
				images: source.images ?? [],
				videos: source.videos ?? [],
				display: storageWorkoutDisplay,
				sourceExerciseOrder: source.exerciseOrder,
				sets: source.sets.map((set) =>
					makeSet(
						sourceSetId(baseline.entity.id, source.exerciseOrder, set.setOrder),
						exerciseKind,
						{
							included: false,
							setLot: set.setLot,
							...measuredStrings(set),
							rpe: rpeInput(set.rpe),
							note: set.note ?? undefined,
							restChoice: restChoiceOf(set.restTime),
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
