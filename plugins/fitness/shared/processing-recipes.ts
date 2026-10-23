import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	column,
	conditional,
	defineRecipe,
	eq,
	literal,
	type Recipe,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedMeasure,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

export const workoutProcessingRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly exerciseId?: string | undefined;
		readonly workoutId?: string | undefined;
	}) => {
		const set = table("event", "processingSet");
		const countStatus = (status: "pending" | "failed") =>
			selectedMeasure(
				{
					function: "sum",
					expr: conditional(
						eq(column(set, "projectionStatus"), literal(status)),
						literal(1),
						literal(0),
					),
				},
				Schema.NullOr(Schema.Finite),
			);
		return {
			map: ({ processing }) =>
				Result.succeed({
					failed: (processing.failed ?? 0) > 0,
					pending: (processing.pending ?? 0) > 0,
				}),
			queries: {
				processing: selectedAggregate(set, {
					measures: { failed: countStatus("failed"), pending: countStatus("pending") },
					where: and(
						schemaOwnerPredicate(set, "eventSchemaPluginId", input.reference),
						eq(column(set, "eventSchemaSlug"), literal("workout-set")),
						...(input.exerciseId === undefined
							? []
							: [eq(column(set, "entityId"), literal(input.exerciseId))]),
						...(input.workoutId === undefined
							? []
							: [eq(column(set, "sessionEntityId"), literal(input.workoutId))]),
					),
				}),
			},
		};
	},
);

export type WorkoutProcessingStatus = Recipe.Success<typeof workoutProcessingRecipe>;
