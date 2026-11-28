import { Array, Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { reject } from "@ryot-app/plugin-backend-sdk/operation";
import type { PluginExecutionRequest } from "@ryot-app/plugin-backend-sdk/ryotql";
import { executeRyotqlRecipe, readAllRyotqlPages } from "@ryot-app/plugin-backend-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";

import { MEASUREMENT_EVENT_BATCH_SIZE } from "../../shared/measurement-reading-operations";
import {
	measurementEntryReadingsRecipe,
	measurementEntryRecipe,
	measurementMetricIdsRecipe,
} from "../../shared/measurement-recipes";
import { catalogMessage } from "../../shared/messages.generated";

type ExecuteRyotql = (request: PluginExecutionRequest) => Effect.Effect<unknown, SandboxHostError>;

export const requireMeasurementEntry = Effect.fn("requireMeasurementEntry")(function* (
	entryId: string,
	executeRyotql: ExecuteRyotql,
) {
	const found = yield* executeRyotqlRecipe(executeRyotql, measurementEntryRecipe, {
		entryId: entryId,
	});
	if (found === null) {
		return yield* reject(catalogMessage("rejection.measurement-entry.missing"));
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
		return yield* reject(catalogMessage("rejection.measurement-metric.missing"));
	}
	return found;
});
