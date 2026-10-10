import { Schema } from "@ryot-app/plugin-client-sdk/effect";

import {
	exerciseForceSchema,
	type ExerciseKind,
	exerciseKindSchema,
	exerciseLevelSchema,
	exerciseMechanicSchema,
} from "../../shared/exercise-kinds";
import {
	type WorkoutExercisePickerResult,
	WorkoutExercisePickerSortSchema,
} from "../../shared/workout-exercise-recipes";

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

export const sortLabels: Record<PickerSort, string> = {
	name: "Name",
	"recently-added": "Recently added",
	"times-performed": "Times performed",
};

export const sortOrder: readonly PickerSort[] = ["times-performed", "name", "recently-added"];

export const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export const labelForKind = (kind: ExerciseKind | null) =>
	kind === null ? "Exercise" : capitalize(kind.replaceAll("_", " "));
