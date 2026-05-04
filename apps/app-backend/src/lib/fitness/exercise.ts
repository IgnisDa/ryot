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
		images: imagesSchema.describe("Cover and demonstration images for this exercise"),
		// muscles is overridden below to enum-array; z.array is used here so that
		// toAppSchemaProperties resolves all other fields (especially images).
		muscles: z.array(muscleEnum).describe("Muscle groups trained by this exercise"),
		instructions: z
			.array(z.string())
			.describe("Step-by-step instructions for performing this exercise"),
		source: z
			.enum(["github", "custom"])
			.describe("Origin of this exercise: github (built-in library) or custom (user-created)"),
		force: z
			.enum(["pull", "push", "static"])
			.nullish()
			.describe("Direction of force applied: pull, push, or static hold"),
		level: z
			.enum(["beginner", "intermediate", "expert"])
			.describe("Recommended experience level: beginner, intermediate, or expert"),
		mechanic: z
			.enum(["compound", "isolation"])
			.nullish()
			.describe(
				"Whether the exercise uses multiple joints (compound) or a single joint (isolation)",
			),
		kind: z
			.enum([
				"reps",
				"duration",
				"reps_and_weight",
				"reps_and_duration",
				"distance_and_duration",
				"reps_and_duration_and_distance",
			])
			.describe("Which measurements are used to track sets of this exercise"),
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
			.nullish()
			.describe("Equipment required to perform this exercise"),
	})
	.strict();

const base = toAppSchemaProperties(exercisePropertiesZodSchema);

export const exercisePropertiesJsonSchema: AppSchema = {
	fields: {
		...base.fields,
		muscles: {
			label: "Muscles",
			type: "enum-array",
			description: "Primary and secondary muscle groups targeted by this exercise",
			validation: { required: true },
			options: muscleEnum.options as [string, ...string[]],
		},
	},
};
