import { DateTime, Effect, Result } from "@ryot-app/plugin-client-sdk/effect";
import {
	defineEntityPresentation,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
} from "@ryot-app/plugin-client-sdk/plugin";

import { WORKOUT_LIST_PAGE_SIZE } from "../shared/workout-list-recipes";
import { invokeWorkoutEditorContext } from "./workout-editor/context-query";
import { buildWorkoutCards, type WorkoutCard } from "./workouts/model";
import { loadWorkoutPages } from "./workouts/queries";
import { WorkoutGridCard, WorkoutListRow } from "./workouts/results";

export const loadWorkoutPresentations: EntityPresentationLoader<WorkoutCard> = ({
	client,
	references,
}) =>
	Effect.gen(function* () {
		const workoutIds = [...new Set(references.map(({ entityId }) => entityId))];
		const [context, pages, now] = yield* Effect.all(
			[
				invokeWorkoutEditorContext(client),
				loadWorkoutPages(client, {
					search: "",
					workoutIds,
					pages: Math.ceil(workoutIds.length / WORKOUT_LIST_PAGE_SIZE),
				}),
				DateTime.now,
			],
			{ concurrency: "unbounded" },
		);
		const cards = buildWorkoutCards({
			...pages,
			now: DateTime.toDate(now),
			imperial: context.settings.unitSystem === "imperial",
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		});
		return Object.fromEntries(cards.map((card) => [card.id, card]));
	});

const prepare = () => Result.fail(new Error("Workout presentations load their own data"));

export const workoutCardPresentation = defineEntityPresentation({
	prepare,
	loader: loadWorkoutPresentations,
	component: ({ data }: EntityPresentationComponentProps<WorkoutCard>) => (
		<WorkoutGridCard card={data} />
	),
});

export const workoutRowPresentation = defineEntityPresentation({
	prepare,
	loader: loadWorkoutPresentations,
	component: ({ data }: EntityPresentationComponentProps<WorkoutCard>) => (
		<WorkoutListRow card={data} />
	),
});
