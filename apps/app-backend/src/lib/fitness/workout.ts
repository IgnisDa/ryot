import { z } from "@hono/zod-openapi";
import type { AppSchema } from "@ryot/ts-utils";
import { toAppSchemaProperties } from "@ryot/ts-utils";

const workoutPropertiesSchema = z
	.object({
		startedAt: z.iso.datetime().describe("Date and time this workout session began"),
		comment: z.string().nullish().describe("Optional notes or comments about this workout"),
		endedAt: z.iso.datetime().nullish().describe("Date and time this workout session ended"),
		caloriesBurnt: z
			.number()
			.int()
			.nullish()
			.describe("Estimated calories burned during this workout"),
	})
	.strict();

const workoutSetPropertiesSchema = z
	.object({
		note: z.string().nullish().describe("Optional note specific to this set"),
		reps: z.number().nullish().describe("Number of repetitions performed in this set"),
		weight: z.number().nullish().describe("Weight used in this set in the user's preferred unit"),
		duration: z.number().nullish().describe("Duration of this set in seconds"),
		distance: z
			.number()
			.nullish()
			.describe("Distance covered in this set in the user's preferred unit"),
		setOrder: z
			.number()
			.int()
			.nonnegative()
			.describe("Zero-based position of this set within the exercise"),
		exerciseOrder: z
			.number()
			.int()
			.nonnegative()
			.describe("Zero-based position of this exercise within the workout"),
		rpe: z
			.number()
			.int()
			.min(0)
			.max(10)
			.nullish()
			.describe("Rate of perceived exertion from 0 (no effort) to 10 (maximal effort)"),
		setLot: z
			.enum(["normal", "warm_up", "drop", "failure"])
			.describe("Set type: normal, warm_up, drop, or failure"),
	})
	.strict();

export const workoutPropertiesJsonSchema: AppSchema =
	toAppSchemaProperties(workoutPropertiesSchema);

export const workoutSetPropertiesJsonSchema: AppSchema = toAppSchemaProperties(
	workoutSetPropertiesSchema,
);
