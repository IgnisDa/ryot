import { z } from "@hono/zod-openapi";
import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { toAppSchemaProperties } from "@ryot/ts-utils/app-schema";

import { entityAssetsSchema, workoutSupersetSchema } from "./schemas";

const workoutPropertiesSchema = z
	.object({
		startedAt: z.iso.datetime().describe("Date and time this workout session began"),
		assets: entityAssetsSchema.nullish().describe("Media assets attached to this workout"),
		comment: z.string().nullish().describe("Optional notes or comments about this workout"),
		endedAt: z.iso.datetime().nullish().describe("Date and time this workout session ended"),
		caloriesBurnt: z.number().nullish().describe("Estimated calories burned during this workout"),
		supersets: z
			.array(workoutSupersetSchema)
			.nullish()
			.describe("Superset groupings for this workout"),
	})
	.strict();

const workoutSetPropertiesSchema = z
	.object({
		pace: z.number().nullish().describe("Pace calculated for this set"),
		note: z.string().nullish().describe("Optional note specific to this set"),
		duration: z.number().nullish().describe("Duration of this set in seconds"),
		oneRm: z.number().nullish().describe("One-rep max calculated for this set"),
		reps: z.number().nullish().describe("Number of repetitions performed in this set"),
		volume: z.number().nullish().describe("Volume (weight × reps) calculated for this set"),
		weight: z.number().nullish().describe("Weight used in this set in the user's preferred unit"),
		distance: z
			.number()
			.nullish()
			.describe("Distance covered in this set in the user's preferred unit"),
		setOrder: z
			.number()
			.int()
			.nonnegative()
			.describe("Zero-based position of this set within the exercise"),
		restTime: z
			.number()
			.int()
			.nonnegative()
			.nullish()
			.describe("Rest time after this set in seconds"),
		exerciseOrder: z
			.number()
			.int()
			.nonnegative()
			.describe("Zero-based position of this exercise within the workout"),
		confirmedAt: z.iso
			.datetime()
			.nullish()
			.describe("Date and time this set was confirmed by the user"),
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
		unitSystem: z
			.enum(["metric", "imperial"])
			.nullish()
			.describe("Unit system used for this exercise in the workout"),
		personalBests: z
			.array(z.enum(["time", "pace", "reps", "one_rm", "volume", "weight", "distance"]))
			.nullish()
			.describe("Personal bests achieved in this set"),
		exerciseAssets: entityAssetsSchema
			.nullish()
			.describe("Media assets attached to this exercise in the workout"),
		restTimerStartedAt: z.iso
			.datetime()
			.nullish()
			.describe("Date and time the rest timer was started after this set"),
	})
	.strict();

export const workoutPropertiesJsonSchema: AppSchema =
	toAppSchemaProperties(workoutPropertiesSchema);

export const workoutSetPropertiesJsonSchema: AppSchema = toAppSchemaProperties(
	workoutSetPropertiesSchema,
);
