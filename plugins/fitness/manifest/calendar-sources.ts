import type { PluginCalendarSource } from "@ryot-app/contract/modules/plugins/manifest";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	concat,
	conditional,
	entitySchemaPredicate,
	eq,
	field,
	literal,
	table,
} from "@ryot-app/ryotql";

import { startedAt, workoutTotals } from "../shared/workout-list-recipes";

const self = { kind: "self" } as const;

const workouts = () => {
	const workout = table("entity", "workout");
	const { exerciseCount } = workoutTotals(workout, "calendarWorkoutSet");
	return {
		icon: "dumbbell",
		slug: "workouts",
		name: "Workouts",
		startAt: "startAt",
		caption: "caption",
		precision: "instant",
		subject: {
			entityAlias: "workout",
			schemas: [{ owner: self, slug: EntitySchemaSlug.make("workout") }],
		},
		query: {
			from: workout,
			where: entitySchemaPredicate(workout, "workout", self),
			output: {
				type: "rows",
				fields: [
					field("startAt", startedAt(workout)),
					field(
						"caption",
						conditional(
							eq(exerciseCount, literal(1)),
							concat(exerciseCount, literal(" exercise")),
							concat(exerciseCount, literal(" exercises")),
						),
					),
				],
			},
		},
	} satisfies PluginCalendarSource;
};

export const fitnessCalendarSources = () => [workouts()];
