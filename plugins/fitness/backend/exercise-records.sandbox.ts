import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { FoldInput, FoldOutput } from "@ryot-app/plugin-backend-sdk/folds";
import { executeRyotqlRecipe, readAllRyotqlPages } from "@ryot-app/plugin-backend-sdk/ryotql";

import { workoutRecordPageRecipe } from "../shared/workout-record-recipes";
import {
	awardWorkoutPersonalBests,
	calculateWorkoutSetStatistics,
	type WorkoutRecordMaxima,
} from "../shared/workout-records";

export const manifest = defineManifest({
	kind: "script",
	name: "Fold exercise records",
	slug: "fold.exercise-records",
});

export default defineScript({
	manifest,
	input: FoldInput,
	output: FoldOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const rows = yield* readAllRyotqlPages((after) =>
				executeRyotqlRecipe(
					host.executeRyotql,
					workoutRecordPageRecipe({ reference: { kind: "self" } }),
					{ exerciseId: input.subjectEntityId },
					{ pages: { records: { after: after } } },
				),
			);
			const maxima: Record<string, WorkoutRecordMaxima> = {};
			const events = rows.map((row) => {
				const measurements = {
					reps: row.reps ?? undefined,
					weight: row.weight ?? undefined,
					duration: row.duration ?? undefined,
					distance: row.distance ?? undefined,
				};
				const awarded = awardWorkoutPersonalBests(
					row.exerciseKind,
					measurements,
					maxima[row.exerciseKind] ?? {},
				);
				maxima[row.exerciseKind] = awarded.maxima;
				return {
					eventId: row.id,
					properties: {
						...calculateWorkoutSetStatistics(row.exerciseKind, measurements),
						personalBests: [...awarded.personalBests],
					},
				};
			});
			return { events, value: null, changes: [], relationships: [] };
		}),
});
