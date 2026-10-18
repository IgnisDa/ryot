import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { ViewFilter, ViewFilterField } from "@ryot-app/plugin-client-sdk/filters";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
} from "@ryot-app/plugin-client-sdk/plugin";
import { collectionsFilterField, compileOptionalFilter } from "@ryot-app/ryotql-recipes/filters";

import { workoutFilterScope } from "../../shared/workout-list-recipes";

type Reference = ReturnType<RyotClient["pluginIdentity"]>;

export const workoutFilterFields = (reference: Reference): readonly ViewFilterField[] => [
	{ type: "date", kind: "value", key: "startedAt", label: "Started", field: "startedAt" },
	{
		kind: "value",
		type: "number",
		key: "exerciseCount",
		field: "exerciseCount",
		label: "Exercise count",
	},
	{ kind: "value", label: "Sets", type: "number", key: "setCount", field: "setCount" },
	{
		kind: "value",
		type: "number",
		key: "personalBests",
		field: "personalBests",
		label: "Personal records",
	},
	{
		key: "template",
		label: "Template",
		kind: "relationship",
		direction: "outgoing",
		relationship: {
			owner: reference,
			slug: RelationshipSchemaSlug.make("workout-to-workout-template"),
		},
	},
	{
		key: "exercises",
		label: "Exercises",
		kind: "session-event",
		event: {
			owner: reference,
			slug: EventSchemaSlug.make("workout-set"),
			entitySchemaSlug: EntitySchemaSlug.make("exercise"),
		},
	},
	collectionsFilterField,
];

export const compileWorkoutFilter = Effect.fnUntraced(function* (input: {
	readonly reference: Reference;
	readonly target: "list" | "weeks";
	readonly filter: null | ViewFilter;
}) {
	const { filter } = input;
	if (filter === null) {
		return undefined;
	}
	const now = yield* DateTime.now;
	return yield* Effect.fromResult(
		compileOptionalFilter(
			{ now, filter },
			{ ...workoutFilterScope(input.target), fields: workoutFilterFields(input.reference) },
		),
	);
});
