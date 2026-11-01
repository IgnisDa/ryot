import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import { userFitnessLibraryRecipe } from "../../shared/library-recipes";
import {
	allMeasurementMetricIdsRecipe,
	measurementPinRelationshipSchemaSlug,
	pinnedMeasurementMetricIdsRecipe,
} from "../../shared/measurement-recipes";

type ExecuteRyotql = ScriptHost["executeRyotql"];

export class MeasurementMetricPinLimitError extends Schema.TaggedError<
	MeasurementMetricPinLimitError,
	{ readonly brand: unique symbol }
>()("MeasurementMetricPinLimitError", { message: Schema.String }) {}

export const pinnedMeasurementMetricIds = (executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, pinnedMeasurementMetricIdsRecipe());

export const measurementMetricIds = (limit: number, executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, allMeasurementMetricIdsRecipe(limit));

export const changeMeasurementMetricPin = Effect.fn("changeMeasurementMetricPin")(function* (
	input: { readonly pinned: boolean; readonly metricId: string },
	host: Pick<ScriptHost, "executeRyotql" | "changeUserRelationships">,
) {
	const fitnessLibrary = yield* executeRyotqlRecipe(
		host.executeRyotql,
		userFitnessLibraryRecipe({ kind: "self" }),
	);
	const identity = {
		sourceEntityId: input.metricId,
		targetEntityId: fitnessLibrary.entityId,
		relationshipSchemaSlug: measurementPinRelationshipSchemaSlug,
	};
	yield* host.changeUserRelationships([
		input.pinned
			? { deletes: [], creates: [{ ...identity, properties: {}, propertiesMode: "merge" }] }
			: { creates: [], deletes: [identity] },
	]);
});
