import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe, type RyotQLDocument } from "@ryot-app/plugin-backend-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";

import { chunk } from "../../shared/collections";
import {
	type MeasurementEntryReading,
	measurementEntryReadingsRecipe,
	measurementEntryRecipe,
	measurementMetricIdsRecipe,
} from "../../shared/measurement-recipes";

type ExecuteRyotql = (document: RyotQLDocument) => Effect.Effect<unknown, SandboxHostError>;

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
	const found = yield* executeRyotqlRecipe(executeRyotql, measurementEntryRecipe(entryId));
	if (found === null) {
		return yield* new MeasurementEntryNotFoundError({ message: "Measurement entry not found" });
	}
	return found;
});

export const readMeasurementEntryReadings = Effect.fn("readMeasurementEntryReadings")(function* (
	entryId: string,
	executeRyotql: ExecuteRyotql,
) {
	const readings: MeasurementEntryReading[] = [];
	const cursors = new Set<string>();
	let after: string | undefined;
	let hasMore = true;
	while (hasMore) {
		const page = yield* executeRyotqlRecipe(
			executeRyotql,
			measurementEntryReadingsRecipe({ after, entryId, reference: { kind: "self" } }),
		);
		readings.push(...page.items);
		hasMore = page.pageInfo.hasMore;
		if (hasMore) {
			const cursor = page.pageInfo.nextCursor;
			if (cursor === null || cursor === "" || cursors.has(cursor)) {
				return yield* Effect.die("Measurement entry pagination did not advance");
			}
			cursors.add(cursor);
			after = cursor;
		}
	}
	return readings;
});

export const requireMeasurementMetrics = Effect.fn("requireMeasurementMetrics")(function* (
	metricIds: readonly string[],
	executeRyotql: ExecuteRyotql,
) {
	const unique = [...new Set(metricIds)];
	const found = (yield* Effect.forEach(chunk(unique, 100), (ids) =>
		executeRyotqlRecipe(executeRyotql, measurementMetricIdsRecipe(ids)),
	)).flat();
	if (found.length !== unique.length) {
		return yield* new MeasurementMetricNotFoundError({ message: "Measurement metric not found" });
	}
	return found;
});
