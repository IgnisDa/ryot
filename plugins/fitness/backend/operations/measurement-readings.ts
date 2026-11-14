import { Array, Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { ExecutionRequest } from "@ryot-app/plugin-backend-sdk/ryotql";
import { executeRyotqlRecipe, readAllRyotqlPages } from "@ryot-app/plugin-backend-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";

import { MEASUREMENT_EVENT_BATCH_SIZE } from "../../shared/measurement-reading-operations";
import {
	measurementEntryReadingsRecipe,
	measurementEntryRecipe,
	measurementMetricIdsRecipe,
} from "../../shared/measurement-recipes";

type ExecuteRyotql = (request: ExecutionRequest) => Effect.Effect<unknown, SandboxHostError>;
export class MeasurementEntryNotFoundError extends Schema.TaggedError<
	MeasurementEntryNotFoundError,
	{ readonly brand: unique symbol }
>()("MeasurementEntryNotFoundError", { message: Schema.String }) {}

export class MeasurementMetricNotFoundError extends Schema.TaggedError<
	MeasurementMetricNotFoundError,
	{ readonly brand: unique symbol }
>()("MeasurementMetricNotFoundError", { message: Schema.String }) {}

export const requireMeasurementEntry = Effect.fn("requireMeasurementEntry")(function* (
	entryId: string,
	executeRyotql: ExecuteRyotql,
) {
	const found = yield* executeRyotqlRecipe(executeRyotql, measurementEntryRecipe, {
		entryId: entryId,
	});
	if (found === null) {
		return yield* new MeasurementEntryNotFoundError({ message: "Measurement entry not found" });
	}
	return found;
});

export const readMeasurementEntryReadings = (entryId: string, executeRyotql: ExecuteRyotql) =>
	readAllRyotqlPages((after) =>
		executeRyotqlRecipe(
			executeRyotql,
			measurementEntryReadingsRecipe({ reference: { kind: "self" } }),
			{ entryId },
			{ pages: { readings: { after: after } } },
		),
	);

export const requireMeasurementMetrics = Effect.fn("requireMeasurementMetrics")(function* (
	metricIds: readonly string[],
	executeRyotql: ExecuteRyotql,
) {
	const unique = [...new Set(metricIds)];
	const found = (yield* Effect.forEach(
		Array.chunksOf(unique, MEASUREMENT_EVENT_BATCH_SIZE),
		(ids) => executeRyotqlRecipe(executeRyotql, measurementMetricIdsRecipe, { metricIds: ids }),
	)).flat();
	if (found.length !== unique.length) {
		return yield* new MeasurementMetricNotFoundError({ message: "Measurement metric not found" });
	}
	return found;
});
