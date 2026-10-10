import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Result, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	executeRyotqlRecipe,
	inArray,
	join,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/sandbox-sdk/ryotql";

import {
	MeasurementReadingDeleteInput,
	MeasurementReadingDeleteOutput,
} from "../../shared/measurement-reading-operations";

export class MeasurementReadingNotFoundError extends Error {
	readonly _tag = "MeasurementReadingNotFoundError";
}

const measurementReadingIdsRecipe = defineRecipe((readingIds: readonly string[]) => {
	const reading = table("event", "reading");
	const metric = table("entity", "metric");
	return {
		map: ({ readings }) => Result.succeed(readings.items.map(({ id }) => id)),
		queries: {
			readings: selectedRows(reading, {
				limit: readingIds.length,
				orderBy: [ascending(column(reading, "id"))],
				selection: { id: selectedField(column(reading, "id"), Schema.String) },
				joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
				where: and(
					inArray(column(reading, "id"), readingIds.map(literal)),
					eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
					eq(column(metric, "entitySchemaSlug"), literal("measurement-metric")),
				),
			}),
		},
	};
});

export const manifest = defineManifest({
	kind: "operation",
	name: "Delete measurement readings",
	slug: "operation.measurement-reading-delete",
});

export default defineOperation({
	manifest,
	input: MeasurementReadingDeleteInput,
	output: MeasurementReadingDeleteOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const readingIds = [...new Set(input.readingIds)];
			const found = yield* executeRyotqlRecipe(
				host.executeRyotql,
				measurementReadingIdsRecipe(readingIds),
			);
			if (found.length !== readingIds.length) {
				return yield* Effect.fail(
					new MeasurementReadingNotFoundError("Measurement reading not found"),
				);
			}
			return yield* host.deleteEvents(readingIds);
		}),
});
