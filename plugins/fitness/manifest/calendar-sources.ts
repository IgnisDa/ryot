import type { PluginCalendarSource } from "@ryot-app/contract/modules/plugins/manifest";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { entitySchemaPredicate, field, table } from "@ryot-app/ryotql";

import { catalogMessage, catalogRowText } from "../shared/messages.generated";
import { startedAt, workoutTotals } from "../shared/workout-list-recipes";

const self = { kind: "self" } as const;

const workouts = () => {
	const workout = table("entity", "workout");
	const { exerciseCount } = workoutTotals(workout, "calendarWorkoutSet");
	return {
		icon: "dumbbell",
		slug: "workouts",
		startAt: "startAt",
		precision: "instant",
		name: catalogMessage("calendar-source.workouts.name"),
		caption: catalogRowText("calendar-source.workouts.caption", { count: "exerciseCount" }),
		subject: {
			entityAlias: "workout",
			schemas: [{ owner: self, slug: EntitySchemaSlug.make("workout") }],
		},
		query: {
			from: workout,
			where: entitySchemaPredicate(workout, "workout", self),
			output: {
				type: "rows",
				fields: [field("startAt", startedAt(workout)), field("exerciseCount", exerciseCount)],
			},
		},
	} satisfies PluginCalendarSource;
};

export const fitnessCalendarSources = () => [workouts()];
