import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	eventSchemaPredicate,
	executeRyotqlRecipe,
	inArray,
	join,
	literal,
	selectedField,
	selectedRows,
	table,
	type RyotQLDocument,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";

type ExecuteRyotql = (document: RyotQLDocument) => Effect.Effect<unknown, SandboxHostError>;

export class MeasurementReadingNotFoundError extends Error {
	readonly _tag = "MeasurementReadingNotFoundError";
}

export class MeasurementMetricNotFoundError extends Error {
	readonly _tag = "MeasurementMetricNotFoundError";
}

const measurementReadingsRecipe = defineRecipe((readingIds: readonly string[]) => {
	const reading = table("event", "reading");
	const metric = table("entity", "metric");
	return {
		map: ({ readings }) => Result.succeed(readings.items),
		queries: {
			readings: selectedRows(reading, {
				limit: readingIds.length,
				orderBy: [ascending(column(reading, "id"))],
				joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
				selection: {
					id: selectedField(column(reading, "id"), Schema.String),
					metricId: selectedField(column(metric, "id"), Schema.String),
				},
				where: and(
					inArray(column(reading, "id"), readingIds.map(literal)),
					eventSchemaPredicate(reading, metric, "measurement-metric", "measurement-reading", {
						kind: "self",
					}),
				),
			}),
		},
	};
});

const measurementMetricIdsRecipe = defineRecipe((metricIds: readonly string[]) => {
	const metric = table("entity", "metric");
	return {
		map: ({ metrics }) => Result.succeed(metrics.items.map(({ id }) => id)),
		queries: {
			metrics: selectedRows(metric, {
				limit: metricIds.length,
				orderBy: [ascending(column(metric, "id"))],
				selection: { id: selectedField(column(metric, "id"), Schema.String) },
				where: and(
					inArray(column(metric, "id"), metricIds.map(literal)),
					entitySchemaPredicate(metric, "measurement-metric", { kind: "self" }),
				),
			}),
		},
	};
});

export const requireMeasurementReadings = (
	readingIds: readonly string[],
	executeRyotql: ExecuteRyotql,
) =>
	Effect.gen(function* () {
		const unique = [...new Set(readingIds)];
		const found = yield* executeRyotqlRecipe(executeRyotql, measurementReadingsRecipe(unique));
		if (found.length !== unique.length) {
			return yield* Effect.fail(
				new MeasurementReadingNotFoundError("Measurement reading not found"),
			);
		}
		return found;
	});

export const requireMeasurementMetrics = (
	metricIds: readonly string[],
	executeRyotql: ExecuteRyotql,
) =>
	Effect.gen(function* () {
		const unique = [...new Set(metricIds)];
		const found =
			unique.length === 0
				? []
				: yield* executeRyotqlRecipe(executeRyotql, measurementMetricIdsRecipe(unique));
		if (found.length !== unique.length) {
			return yield* Effect.fail(new MeasurementMetricNotFoundError("Measurement metric not found"));
		}
		return found;
	});
