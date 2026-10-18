import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe, type RyotQLDocument } from "@ryot-app/plugin-backend-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";

import {
	measurementMetricIdsRecipe,
	measurementReadingsRecipe,
} from "../../shared/measurement-recipes";

type ExecuteRyotql = (document: RyotQLDocument) => Effect.Effect<unknown, SandboxHostError>;

export class MeasurementReadingNotFoundError extends Schema.TaggedError<
	MeasurementReadingNotFoundError,
	{ readonly brand: unique symbol }
>()("MeasurementReadingNotFoundError", { message: Schema.String }) {}

export class MeasurementMetricNotFoundError extends Schema.TaggedError<
	MeasurementMetricNotFoundError,
	{ readonly brand: unique symbol }
>()("MeasurementMetricNotFoundError", { message: Schema.String }) {}

export const requireMeasurementReadings = Effect.fn("requireMeasurementReadings")(function* (
	readingIds: readonly string[],
	executeRyotql: ExecuteRyotql,
) {
	const unique = [...new Set(readingIds)];
	const found = yield* executeRyotqlRecipe(executeRyotql, measurementReadingsRecipe(unique));
	if (found.length !== unique.length) {
		return yield* new MeasurementReadingNotFoundError({ message: "Measurement reading not found" });
	}
	return found;
});

export const requireMeasurementMetrics = Effect.fn("requireMeasurementMetrics")(function* (
	metricIds: readonly string[],
	executeRyotql: ExecuteRyotql,
) {
	const unique = [...new Set(metricIds)];
	const found =
		unique.length === 0
			? []
			: yield* executeRyotqlRecipe(executeRyotql, measurementMetricIdsRecipe(unique));
	if (found.length !== unique.length) {
		return yield* new MeasurementMetricNotFoundError({ message: "Measurement metric not found" });
	}
	return found;
});
