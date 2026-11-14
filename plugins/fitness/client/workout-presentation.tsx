import { Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	defineEntityPresentation,
	type EntityPresentationComponentProps,
	type EntityPresentationPrepare,
} from "@ryot-app/plugin-client-sdk/plugin";

import { WorkoutPreferenceSettingsSchema } from "../shared/workout-editor-preferences";
import { workoutPresentationSource } from "../shared/workout-list-recipes";
import { fitnessEntityCardPresentation, fitnessEntityRowPresentation } from "./entity-presentation";
import { buildWorkoutCards, type WorkoutCard } from "./workouts/model";
import { WorkoutGridCard, WorkoutListRow } from "./workouts/results";

export const prepareWorkoutPresentations: EntityPresentationPrepare<WorkoutCard> = ({
	sources,
	context,
	references,
}) =>
	Result.gen(function* () {
		if (context === undefined) {
			return yield* Result.fail(new Error("Workout presentation context is missing"));
		}
		const settings = yield* Schema.decodeUnknownResult(WorkoutPreferenceSettingsSchema)(
			context.settings,
		);
		const source = workoutPresentationSource();
		const rows = yield* Result.all(
			references.map((reference) => source.decode(sources.get(reference.entityId))),
		);
		const cards = buildWorkoutCards({
			now: new Date(context.now),
			timeZone: context.timeZone,
			imperial: settings.unitSystem === "imperial",
			comparisons: rows.flatMap((row) => row.comparisons.items),
			items: rows.map(({ sets, template, ...item }) =>
				Object.assign(item, { sets: sets.items, template: template.items[0] ?? null }),
			),
		});
		return Object.fromEntries(cards.map((card) => [card.id, card]));
	});
export const workoutCardPresentation = defineEntityPresentation({
	prepare: prepareWorkoutPresentations,
	entity: fitnessEntityCardPresentation,
	component: ({ data }: EntityPresentationComponentProps<WorkoutCard>) => (
		<WorkoutGridCard card={data} />
	),
});
export const workoutRowPresentation = defineEntityPresentation({
	prepare: prepareWorkoutPresentations,
	entity: fitnessEntityRowPresentation,
	component: ({ data }: EntityPresentationComponentProps<WorkoutCard>) => (
		<WorkoutListRow card={data} />
	),
});
