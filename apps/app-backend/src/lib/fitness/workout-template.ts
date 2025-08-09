import { z } from "@hono/zod-openapi";
import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { toAppSchemaProperties } from "@ryot/ts-utils/app-schema";

const workoutTemplateSetSchema = z
	.object({
		note: z.string().nullish().describe("Optional note specific to this set"),
		reps: z.number().nullish().describe("Number of repetitions planned for this set"),
		duration: z.number().nullish().describe("Duration planned for this set in seconds"),
		setLot: z
			.enum(["normal", "warm_up", "drop", "failure"])
			.describe("Set type: normal, warm_up, drop, or failure"),
		weight: z
			.number()
			.nullish()
			.describe("Weight planned for this set in the user's preferred unit"),
		distance: z
			.number()
			.nullish()
			.describe("Distance planned for this set in the user's preferred unit"),
		setOrder: z
			.number()
			.int()
			.nonnegative()
			.describe("Zero-based position of this set within the exercise"),
		rpe: z
			.number()
			.int()
			.min(0)
			.max(10)
			.nullish()
			.describe("Planned rate of perceived exertion from 0 (no effort) to 10 (maximal effort)"),
	})
	.strict()
	.describe("Set planned in this exercise");

const workoutTemplateExerciseSchema = z
	.object({
		exerciseId: z.string().describe("Entity id of the exercise"),
		notes: z.array(z.string()).describe("Notes for this exercise"),
		sets: z.array(workoutTemplateSetSchema).describe("Sets planned for this exercise"),
		exerciseOrder: z
			.number()
			.int()
			.nonnegative()
			.describe("Zero-based position of this exercise within the template"),
	})
	.strict()
	.describe("Exercise in this template");

const workoutTemplateSupersetSchema = z
	.object({
		color: z.string().describe("Display color for this superset"),
		exercises: z
			.array(z.number().int().nonnegative())
			.describe("Zero-based exercise positions in this superset"),
	})
	.strict()
	.describe("Superset in this template");

const workoutTemplatePropertiesSchema = z
	.object({
		comment: z.string().nullish().describe("Optional notes about this workout template"),
		exercises: z.array(workoutTemplateExerciseSchema).describe("Exercises in this template"),
		supersets: z.array(workoutTemplateSupersetSchema).describe("Supersets in this template"),
	})
	.strict();

export type WorkoutTemplateProperties = z.infer<typeof workoutTemplatePropertiesSchema>;

export const workoutTemplatePropertiesJsonSchema: AppSchema = toAppSchemaProperties(
	workoutTemplatePropertiesSchema,
);
