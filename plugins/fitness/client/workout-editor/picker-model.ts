import { Schema } from "@ryot-app/plugin-client-sdk/effect";

import {
	exerciseForceSchema,
	exerciseKindSchema,
	exerciseLevelSchema,
	exerciseMechanicSchema,
} from "../../shared/exercise-kinds";
import {
	type WorkoutExercisePickerResult,
	WorkoutExercisePickerSortSchema,
} from "../../shared/workout-exercise-recipes";
import type { FitnessText } from "../messages";

export const PickerFiltersSchema = Schema.Struct({
	targetIds: Schema.Array(Schema.String),
	kinds: Schema.Array(exerciseKindSchema),
	forces: Schema.Array(exerciseForceSchema),
	levels: Schema.Array(exerciseLevelSchema),
	equipmentIds: Schema.Array(Schema.String),
	collectionIds: Schema.Array(Schema.String),
	mechanics: Schema.Array(exerciseMechanicSchema),
});

export const PickerPresetsSchema = Schema.Array(
	Schema.Struct({
		id: Schema.String,
		filters: PickerFiltersSchema,
		sort: WorkoutExercisePickerSortSchema,
		search: Schema.String.pipe(Schema.check(Schema.isMaxLength(512))),
		name: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
	}),
).pipe(Schema.check(Schema.isMaxLength(20)));

export type PickerFilters = typeof PickerFiltersSchema.Type;
export type PickerSort = typeof WorkoutExercisePickerSortSchema.Type;
export type PickerPreset = (typeof PickerPresetsSchema.Type)[number];
export type PickerExercise = WorkoutExercisePickerResult["items"][number];

export const maxPickerPresets = 20;

export const emptyFilters: PickerFilters = {
	kinds: [],
	forces: [],
	levels: [],
	mechanics: [],
	targetIds: [],
	equipmentIds: [],
	collectionIds: [],
};

const sortCodes = {
	name: "name",
	"recently-added": "recently_added",
	"times-performed": "times_performed",
} as const satisfies Record<PickerSort, string>;

export const sortLabel = (text: FitnessText, sort: PickerSort) =>
	text("client.picker.sort", { sort: sortCodes[sort] });

export const sortOrder: readonly PickerSort[] = ["times-performed", "name", "recently-added"];
