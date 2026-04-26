import { z } from "@hono/zod-openapi";
import type { AppSchema } from "@ryot/ts-utils";
import { toAppSchemaProperties } from "@ryot/ts-utils";

const workoutPropertiesSchema = z
	.object({
		startedAt: z.iso.datetime(),
		comment: z.string().nullish(),
		endedAt: z.iso.datetime().nullish(),
		caloriesBurnt: z.number().int().nullish(),
	})
	.strict();

const workoutSetPropertiesSchema = z
	.object({
		note: z.string().nullish(),
		reps: z.number().nullish(),
		weight: z.number().nullish(),
		duration: z.number().nullish(),
		distance: z.number().nullish(),
		setOrder: z.number().int().nonnegative(),
		exerciseOrder: z.number().int().nonnegative(),
		rpe: z.number().int().min(0).max(10).nullish(),
		setLot: z.enum(["normal", "warm_up", "drop", "failure"]),
	})
	.strict();

export const workoutPropertiesJsonSchema: AppSchema = toAppSchemaProperties(
	workoutPropertiesSchema,
);

export const workoutSetPropertiesJsonSchema: AppSchema = toAppSchemaProperties(
	workoutSetPropertiesSchema,
);
