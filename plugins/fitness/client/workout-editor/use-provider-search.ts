import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { readCursorPages } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { EntitySchemaSlug } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { useEffect, useRef, useState } from "react";

import type { ExerciseKind } from "../../shared/exercise-kinds";
import { fitnessLibraryMembership } from "../../shared/library-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { workoutExercisePickerRecipe } from "../../shared/workout-exercise-recipes";
import type { PickerExercise } from "./picker-model";

type PickerInput = Parameters<typeof workoutExercisePickerRecipe>[0];

const readLibraryExercises = (client: RyotClient, exerciseIds: PickerInput["exerciseIds"]) =>
	readCursorPages((after) =>
		client.data.query(
			workoutExercisePickerRecipe({
				after,
				exerciseIds,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
	).pipe(Effect.map(({ items }) => items));

export function useProviderSearch(input: {
	readonly search: string;
	readonly onCreateRequested: () => void;
	readonly replacementKind: undefined | ExerciseKind;
	readonly onFound: (exercises: readonly PickerExercise[]) => void;
}) {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const { pluginId } = client.pluginIdentity(PLUGIN_PACKAGE_ID);
	const running = useRef(false);
	const cancel = useRef<undefined | (() => void)>(undefined);
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);
	const [notice, setNotice] = useState<string>();

	useEffect(() => () => cancel.current?.(), []);

	const open = () => {
		if (running.current) {
			return;
		}
		running.current = true;
		setPending(true);
		setFailed(false);
		setNotice(undefined);
		cancel.current = schedule.run(
			Effect.gen(function* () {
				const outcome = yield* client.screens.pickEntity({
					initialQuery: input.search,
					library: fitnessLibraryMembership,
					schema: { owner: { pluginId, kind: "plugin" }, slug: EntitySchemaSlug.make("exercise") },
				});
				if (outcome.kind === "cancelled") {
					return;
				}
				if (outcome.kind === "create-requested") {
					input.onCreateRequested();
					return;
				}
				const exercises = yield* readLibraryExercises(client, outcome.entityIds);
				const eligible = exercises.filter(
					(exercise) =>
						exercise.kind !== null &&
						(input.replacementKind === undefined || exercise.kind === input.replacementKind),
				);
				if (eligible.length < exercises.length) {
					setNotice(
						"The exercise was added to your library, but its kind is not eligible for this selection.",
					);
				}
				input.onFound(eligible);
			}).pipe(Effect.catch(() => Effect.sync(() => setFailed(true)))),
			() => {
				running.current = false;
				setPending(false);
			},
		);
	};

	return { open, notice, failed, pending };
}
