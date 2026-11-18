import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Option, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	type FoldEventImage,
	FoldInput,
	FoldOutput,
	foldChangeImages,
} from "@ryot-app/plugin-backend-sdk/folds";
import { executeRyotqlRecipe, readAllRyotqlPages } from "@ryot-app/plugin-backend-sdk/ryotql";

import { exerciseKindSchema } from "../shared/exercise-kinds";
import {
	type WorkoutRecordRange,
	workoutRecordPageRecipe,
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

const reference = { kind: "self" } as const;

const SetProperties = Schema.Struct({
	exerciseKind: exerciseKindSchema,
	reps: Schema.optional(Schema.Finite),
	weight: Schema.optional(Schema.Finite),
	duration: Schema.optional(Schema.Finite),
	distance: Schema.optional(Schema.Finite),
	setOrder: Schema.optional(Schema.Finite),
	exerciseOrder: Schema.optional(Schema.Finite),
});

const recordSetOf = Effect.fnUntraced(function* (
	image: FoldEventImage,
	startedAt: null | string,
) {
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

export default defineScript({
	manifest,
	input: FoldInput,
	output: FoldOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const sets = (range?: WorkoutRecordRange) =>
				readAllRyotqlPages((after) =>
					executeRyotqlRecipe(
						host.executeRyotql,
						workoutRecordPageRecipe(range === undefined ? { reference } : { reference, range }),
						{ exerciseId: input.subjectEntityId },
						{ pages: { records: { after: after } } },
					),
				);
			const encode = Schema.encodeEffect(Schema.toCodecJson(ExerciseRecordsValue));
			const previous = Schema.decodeUnknownOption(ExerciseRecordsValue)(input.value);
			if (input.changes === null || Option.isNone(previous)) {
				const replayed = replayExerciseRecords(yield* sets());
				return {
					changes: [],
					relationships: [],
					events: replayed.events,
					value: yield* encode(replayed.value),
				};
			}
			const { added, retracted } = foldChangeImages(input.changes);
			const workoutIds = [
				...new Set(added.flatMap(({ sessionEntityId }) => (sessionEntityId ? [sessionEntityId] : []))),
			];
			const starts = new Map(
				workoutIds.length === 0
					? []
					: (yield* executeRyotqlRecipe(host.executeRyotql, workoutStartsRecipe({ reference }), {
							workoutIds,
						})).items.map(({ id, startedAt }) => [id, startedAt] as const),
			);
			const updated = yield* updateExerciseRecords({
				value: previous.value,
				later: (range) => sets(range),
				retracted: yield* Effect.forEach(retracted, (image) => recordSetOf(image, null)),
				added: yield* Effect.forEach(
					added.filter(({ sessionEntityId }) => sessionEntityId !== null && starts.has(sessionEntityId)),
					(image) => recordSetOf(image, starts.get(image.sessionEntityId ?? "") ?? null),
				),
			});
			return {
				changes: [],
				relationships: [],
				events: updated.events,
				value: yield* encode(updated.value),
			};
		}),
});
