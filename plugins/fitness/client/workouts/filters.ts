import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { collectionsFilterField, type QueryFilterField } from "@ryot-app/plugin-client-sdk/filters";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
} from "@ryot-app/plugin-client-sdk/plugin";

type WorkoutFilterField = QueryFilterField;

type Reference = ReturnType<RyotClient["pluginIdentity"]>;

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
