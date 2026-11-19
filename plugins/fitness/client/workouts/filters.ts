import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { collectionsFilterField, type QueryFilterField } from "@ryot-app/plugin-client-sdk/filters";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
} from "@ryot-app/plugin-client-sdk/plugin";

import type { FitnessText } from "../messages";

type WorkoutFilterField = QueryFilterField;

type Reference = ReturnType<RyotClient["pluginIdentity"]>;

export const workoutFilterFields = (
	text: FitnessText,
	reference: Reference,
): readonly WorkoutFilterField[] => [
	{
		type: "date",
		kind: "value",
		key: "startedAt",
		field: "startedAt",
		label: text("browse.field.started"),
	},
	{
		kind: "value",
		type: "number",
		key: "exerciseCount",
		field: "exerciseCount",
		label: text("browse.field.exercise-count"),
	},
	{
		kind: "value",
		type: "number",
		key: "setCount",
		field: "setCount",
		label: text("property.sets"),
	},
	{
		kind: "value",
		type: "number",
		key: "personalBests",
		field: "personalBests",
		label: text("client.workouts.filter-records"),
	},
	{
		key: "template",
		kind: "relationship",
		direction: "outgoing",
		label: text("browse.field.template"),
		relationship: {
			owner: reference,
			slug: RelationshipSchemaSlug.make("workout-to-workout-template"),
		},
	},
	{
		key: "exercises",
		kind: "session-event",
		label: text("property.exercises"),
		event: {
			owner: reference,
			slug: EventSchemaSlug.make("workout-set"),
			entitySchemaSlug: EntitySchemaSlug.make("exercise"),
		},
	},
	collectionsFilterField,
];
