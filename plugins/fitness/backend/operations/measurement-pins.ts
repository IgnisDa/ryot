import {
	type ChangeSetEntityReference,
	existingEntity,
	type ScriptHost,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { userFitnessLibraryRecipe } from "../../shared/library-recipes";
import {
	allMeasurementMetricIdsRecipe,
	measurementPinRelationshipSchemaSlug,
	pinnedMeasurementMetricIdsRecipe,
} from "../../shared/measurement-recipes";

type ExecuteRyotql = ScriptHost["executeRyotql"];

export const pinnedMeasurementMetricIds = (executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, pinnedMeasurementMetricIdsRecipe, {});
export const measurementMetricIds = (executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, allMeasurementMetricIdsRecipe, {});
export const measurementMetricPinChanges = Effect.fn("measurementMetricPinChanges")(function* (
	input: { readonly pinned: boolean; readonly metric: ChangeSetEntityReference },
	executeRyotql: ExecuteRyotql,
) {
	const fitnessLibrary = yield* executeRyotqlRecipe(
		executeRyotql,
		userFitnessLibraryRecipe({ kind: "self" }),
		{},
	);
	const identity = {
		source: input.metric,
		relationshipSchemaSlug: measurementPinRelationshipSchemaSlug,
		target: existingEntity(EntityId.make(fitnessLibrary.entityId)),
	};
	return input.pinned
		? {
				relationships: {
					upserts: [{ ...identity, properties: {}, propertiesMode: "merge" as const }],
				},
			}
		: { relationships: { deletes: [identity] } };
});
