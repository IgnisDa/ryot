import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { ViewFilter } from "@ryot-app/plugin-client-sdk/filters";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	collectionsFilterField,
	compileOptionalFilter,
	outputFilterTargets,
} from "@ryot-app/ryotql-recipes/filters";

import { workoutFilterScope } from "../../shared/workout-list-recipes";

type Reference = ReturnType<RyotClient["pluginIdentity"]>;

type WorkoutFilterField = Parameters<typeof outputFilterTargets>[1][number];

export const workoutFilterFields = (reference: Reference): readonly WorkoutFilterField[] => [
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
	const scope = workoutFilterScope(input.target);
	const targets = yield* Effect.fromResult(
		outputFilterTargets(scope.source, workoutFilterFields(input.reference)),
	);
	return yield* Effect.fromResult(compileOptionalFilter({ now, filter }, { ...scope, targets }));
});
