import { z } from "@hono/zod-openapi";
import type { AppSchema } from "@ryot/ts-utils";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { imagesSchema } from "~/lib/zod";

const muscleEnum = z.enum([
	"lats",
	"neck",
	"traps",
	"chest",
	"biceps",
	"calves",
	"glutes",
	"triceps",
	"forearms",
	"abductors",
	"adductors",
	"shoulders",
	"lower_back",
	"abdominals",
	"hamstrings",
	"quadriceps",
	"middle_back",
]);

const exercisePropertiesZodSchema = z
	.object({
		images: imagesSchema,
		// muscles is overridden below to enum-array; z.array is used here so that
		// toAppSchemaProperties resolves all other fields (especially images).
		muscles: z.array(muscleEnum),
		instructions: z.array(z.string()),
		source: z.enum(["github", "custom"]),
		force: z.enum(["pull", "push", "static"]).nullish(),
		level: z.enum(["beginner", "intermediate", "expert"]),
		mechanic: z.enum(["compound", "isolation"]).nullish(),
		kind: z.enum([
			"reps",
			"duration",
			"reps_and_weight",
			"reps_and_duration",
			"distance_and_duration",
			"reps_and_duration_and_distance",
		]),
		equipment: z
			.enum([
				"bands",
				"cable",
				"other",
				"barbell",
				"machine",
				"body_only",
				"dumbbell",
				"foam_roll",
				"ez_curl_bar",
				"kettlebells",
				"exercise_ball",
				"medicine_ball",
			])
			.nullish(),
	})
	.strict();

const _base = toAppSchemaProperties(exercisePropertiesZodSchema);

export const exercisePropertiesJsonSchema: AppSchema = {
	fields: {
		..._base.fields,
		muscles: {
			label: "Muscles",
			type: "enum-array",
			validation: { required: true },
			options: muscleEnum.options as [string, ...string[]],
		},
	},
};
