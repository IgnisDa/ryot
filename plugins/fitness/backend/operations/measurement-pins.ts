import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { Effect, Result, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	executeRyotqlRecipe,
	relationshipSchemaPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/sandbox-sdk/ryotql";

import { userFitnessLibraryRecipe } from "../../shared/library-recipes";

type ExecuteRyotql = ScriptHost["executeRyotql"];

const pinRelationshipSchemaSlug = "measurement-metric-pinned";

export class MeasurementMetricPinLimitError extends Error {
	readonly _tag = "MeasurementMetricPinLimitError";
}

const pinnedMetricIdsRecipe = defineRecipe(() => {
	const pin = table("relationship", "pin");
	return {
		map: ({ pins }) => Result.succeed(pins.items.map(({ metricId }) => metricId)),
		queries: {
			pins: selectedRows(pin, {
				limit: 100,
				orderBy: [ascending(column(pin, "id"))],
				where: relationshipSchemaPredicate(pin, pinRelationshipSchemaSlug, { kind: "self" }),
				selection: { metricId: selectedField(column(pin, "sourceEntityId"), Schema.String) },
			}),
		},
	};
});

const metricIdsRecipe = defineRecipe((limit: number) => {
	const metric = table("entity", "metric");
	return {
		map: ({ metrics }) => Result.succeed(metrics.items.map(({ id }) => id)),
		queries: {
			metrics: selectedRows(metric, {
				limit,
				orderBy: [ascending(column(metric, "id"))],
				selection: { id: selectedField(column(metric, "id"), Schema.String) },
				where: entitySchemaPredicate(metric, "measurement-metric", { kind: "self" }),
			}),
		},
	};
});

export const pinnedMeasurementMetricIds = (executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, pinnedMetricIdsRecipe());

export const measurementMetricIds = (limit: number, executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, metricIdsRecipe(limit));

export const changeMeasurementMetricPin = (
	input: { readonly pinned: boolean; readonly metricId: string },
	host: Pick<ScriptHost, "changeUserRelationships" | "executeRyotql">,
) =>
	Effect.gen(function* () {
		const fitnessLibrary = yield* executeRyotqlRecipe(
			host.executeRyotql,
			userFitnessLibraryRecipe({ kind: "self" }),
		);
		const identity = {
			sourceEntityId: input.metricId,
			targetEntityId: fitnessLibrary.entityId,
			relationshipSchemaSlug: pinRelationshipSchemaSlug,
		};
		yield* host.changeUserRelationships([
			input.pinned
				? { deletes: [], creates: [{ ...identity, properties: {}, propertiesMode: "merge" }] }
				: { creates: [], deletes: [identity] },
		]);
	});
