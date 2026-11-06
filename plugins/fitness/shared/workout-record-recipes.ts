import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	coalesce,
	column,
	defineRecipe,
	eq,
	join,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";
import { EventId } from "@ryot-app/plugin-kit/schema";

import { property, propertyDate, propertyNumber } from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";

export const workoutRecordPageSize = 100;

const unorderedLast = 2_147_483_647;

export const workoutRecordPageRecipe = defineRecipe(
	(input: {
		readonly exerciseId: string;
		readonly after?: string | undefined;
		readonly reference: PluginIdentityReference;
	}) => {
		const event = table("event", "workoutRecord");
		const exercise = table("entity", "exercise");
		const workout = table("entity", "workout");
		return {
			map: ({ records }) => Result.succeed(records),
			queries: {
				records: selectedRows(event, {
					after: input.after,
					limit: workoutRecordPageSize,
					joins: [
						join("inner", exercise, eq(column(event, "entityId"), column(exercise, "id"))),
						join("inner", workout, eq(column(event, "sessionEntityId"), column(workout, "id"))),
					],
					orderBy: [
						ascending(column(event, "occurredAt")),
						ascending(propertyDate(workout, "startedAt")),
						ascending(column(event, "sessionEntityId")),
						ascending(coalesce(propertyNumber(event, "exerciseOrder"), literal(unorderedLast))),
						ascending(coalesce(propertyNumber(event, "setOrder"), literal(unorderedLast))),
						ascending(column(event, "id")),
					],
					where: and(
						schemaOwnerPredicate(exercise, "entitySchemaPluginId", input.reference),
						schemaOwnerPredicate(workout, "entitySchemaPluginId", input.reference),
						schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
						eq(column(event, "entityId"), literal(input.exerciseId)),
						eq(column(event, "eventSchemaSlug"), literal("workout-set")),
						eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
						eq(column(workout, "entitySchemaSlug"), literal("workout")),
					),
					selection: {
						id: selectedField(column(event, "id"), EventId),
						exerciseKind: selectedField(property(event, "exerciseKind"), exerciseKindSchema),
						reps: selectedField(propertyNumber(event, "reps"), Schema.NullOr(Schema.Finite)),
						weight: selectedField(propertyNumber(event, "weight"), Schema.NullOr(Schema.Finite)),
						duration: selectedField(
							propertyNumber(event, "duration"),
							Schema.NullOr(Schema.Finite),
						),
						distance: selectedField(
							propertyNumber(event, "distance"),
							Schema.NullOr(Schema.Finite),
						),
					},
				}),
			},
		};
	},
);
