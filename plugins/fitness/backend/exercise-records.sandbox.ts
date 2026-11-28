import { readAllPages, type ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	foldChangeImages,
	type FoldEventImage,
	FoldInput,
	FoldOutput,
	foldSubjects,
} from "@ryot-app/plugin-backend-sdk/folds";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import { exerciseKindSchema } from "../shared/exercise-kinds";
import {
	workoutRecordRangeArguments,
	workoutRecordRangeRecipe,
	workoutRecordsRecipe,
	workoutStartsRecipe,
} from "../shared/workout-record-recipes";
import {
	ExerciseRecordsValue,
	type RecordSet,
	replayExerciseRecords,
	updateExerciseRecords,
} from "./exercise-records";

export const manifest = defineManifest({
	kind: "script",
	name: "Fold exercise records",
	slug: "fold.exercise-records",
});

const SetProperties = Schema.Struct({
	exerciseKind: exerciseKindSchema,
	reps: Schema.optional(Schema.Finite),
	weight: Schema.optional(Schema.Finite),
	duration: Schema.optional(Schema.Finite),
	distance: Schema.optional(Schema.Finite),
	setOrder: Schema.optional(Schema.Finite),
	exerciseOrder: Schema.optional(Schema.Finite),
});

const recordSetOf = Effect.fnUntraced(function* (image: FoldEventImage, startedAt: null | string) {
	const properties = yield* Schema.decodeUnknownEffect(SetProperties)(image.properties);
	return {
		startedAt,
		id: image.id,
		occurredAt: image.occurredAt,
		reps: properties.reps ?? null,
		weight: properties.weight ?? null,
		duration: properties.duration ?? null,
		distance: properties.distance ?? null,
		setOrder: properties.setOrder ?? null,
		exerciseKind: properties.exerciseKind,
		sessionEntityId: image.sessionEntityId ?? "",
		exerciseOrder: properties.exerciseOrder ?? null,
	} satisfies RecordSet;
});

const replay = (exerciseId: string, host: ScriptHost) =>
	readAllPages((after) =>
		executeRyotqlRecipe(
			host.executeRyotql,
			workoutRecordsRecipe,
			{ exerciseId },
			{ pages: { records: { after } } },
		),
	).pipe(
		Effect.map((sets) => {
			const replayed = replayExerciseRecords(sets);
			return { changes: [], relationships: [], value: replayed.value, events: replayed.events };
		}),
	);

export default defineScript({
	manifest,
	input: FoldInput,
	output: FoldOutput,
	run: foldSubjects({
		value: ExerciseRecordsValue,
		replay: ({ subjectEntityId }, host) => replay(subjectEntityId, host),
		update: ({ value, changes, subjectEntityId }, host) =>
			Effect.gen(function* () {
				const { added, retracted } = foldChangeImages(changes);
				const workoutIds = [
					...new Set(
						added.flatMap(({ sessionEntityId }) => (sessionEntityId ? [sessionEntityId] : [])),
					),
				];
				const starts = new Map(
					workoutIds.length === 0
						? []
						: (yield* readAllPages((after) =>
								executeRyotqlRecipe(
									host.executeRyotql,
									workoutStartsRecipe,
									{ workoutIds },
									{ pages: { workouts: { after } } },
								),
							)).map(({ id, startedAt }) => [id, startedAt] as const),
				);
				if (workoutIds.some((workoutId) => !starts.has(workoutId))) {
					return yield* replay(subjectEntityId, host);
				}
				const updated = yield* updateExerciseRecords({
					value,
					retracted: yield* Effect.forEach(retracted, (image) => recordSetOf(image, null)),
					added: yield* Effect.forEach(
						added.filter(({ sessionEntityId }) => sessionEntityId !== null),
						(image) => recordSetOf(image, starts.get(image.sessionEntityId ?? "") ?? null),
					),
					later: (range) =>
						readAllPages((after) =>
							executeRyotqlRecipe(
								host.executeRyotql,
								workoutRecordRangeRecipe,
								{ ...workoutRecordRangeArguments(range), exerciseId: subjectEntityId },
								{ pages: { records: { after } } },
							),
						),
				});
				return { changes: [], relationships: [], value: updated.value, events: updated.events };
			}),
	}),
});
