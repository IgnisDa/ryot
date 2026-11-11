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
	parameters,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";
import { EventId } from "@ryot-app/plugin-kit/schema";

import { property, propertyDate, propertyNumber } from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";

const workoutRecordPageSize = 100;
const unorderedLast = 2147483647;
export const workoutRecordPageRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			exerciseId: {
				type: "string",
				label: "Exercise Id",
				validation: { required: true },
				description: "Exercise Id for this selection",
			},
		},
	});
	const event = table("event", "workoutRecord");
	const exercise = table("entity", "exercise");
	const workout = table("entity", "workout");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ records }) => Result.succeed(records),
		queries: {
			records: selectedRows(event, {
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
					eq(column(event, "entityId"), inputParameters.value("exerciseId")),
					eq(column(event, "eventSchemaSlug"), literal("workout-set")),
					eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
					eq(column(workout, "entitySchemaSlug"), literal("workout")),
				),
				selection: {
					id: selectedField(column(event, "id"), EventId),
					exerciseKind: selectedField(property(event, "exerciseKind"), exerciseKindSchema),
					reps: selectedField(propertyNumber(event, "reps"), Schema.NullOr(Schema.Finite)),
					weight: selectedField(propertyNumber(event, "weight"), Schema.NullOr(Schema.Finite)),
					duration: selectedField(propertyNumber(event, "duration"), Schema.NullOr(Schema.Finite)),
					distance: selectedField(propertyNumber(event, "distance"), Schema.NullOr(Schema.Finite)),
				},
			}),
		},
	});
};
