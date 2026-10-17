import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { ViewFilter, ViewFilterField } from "@ryot-app/plugin-client-sdk/filters";
import { RelationshipSchemaSlug } from "@ryot-app/plugin-client-sdk/plugin";
import { compileOptionalFilter, collectionsFilterField } from "@ryot-app/ryotql-recipes/filters";

import { workoutFilterScope } from "../../shared/workout-list-recipes";

type Reference = ReturnType<RyotClient["pluginIdentity"]>;

export const workoutFilterFields = (reference: Reference): readonly ViewFilterField[] => [
	{ type: "date", kind: "value", key: "startedAt", label: "Started", field: "startedAt" },
	{
		kind: "value",
		type: "number",
		label: "Exercises",
		key: "exerciseCount",
		field: "exerciseCount",
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
	collectionsFilterField,
];

export const compileWorkoutFilter = Effect.fnUntraced(function* (input: {
	readonly filter: ViewFilter | null;
	readonly target: "list" | "weeks";
	readonly reference: Reference;
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
