import { readCursorPages, type RyotClient, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { exerciseEquipmentRecipe, exerciseTargetsRecipe } from "../../shared/taxonomy-recipes";
import { WorkoutExerciseOverridesSchema } from "../../shared/workout-editor-preferences";
import {
	WORKOUT_EDITOR_PAGE_SIZE,
	workoutEditorEntityRecipe,
	type WorkoutEditorExercise,
	workoutEditorExercisesRecipe,
	workoutEditorMembershipRecipe,
	workoutEditorSetsRecipe,
} from "../../shared/workout-editor-recipes";
import { hydrateWorkoutEditorSource } from "../../shared/workout-editor-source";
import {
	workoutExercisePreviousValuesRecipe,
	workoutHistoryRecipe,
	workoutHistorySetsRecipe,
} from "../../shared/workout-history-recipes";

export const readEditorExercises = Effect.fnUntraced(function* (
	client: RyotClient,
	exerciseIds: readonly string[],
) {
	if (exerciseIds.length === 0) {
		return [];
	}
	const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
	const exercises: WorkoutEditorExercise[] = [];
	for (let offset = 0; offset < exerciseIds.length; offset += 100) {
		const page = yield* readCursorPages((after) =>
			client.data.query(
				workoutEditorExercisesRecipe({
					after,
					reference,
					exerciseIds: exerciseIds.slice(offset, offset + 100),
				}),
			),
		);
		exercises.push(...page.items);
	}
	return yield* Effect.forEach(
		exercises,
		(exercise) =>
			Effect.gen(function* () {
				const membership = yield* client.data.query(
					workoutEditorMembershipRecipe({ reference, exerciseId: exercise.id }),
				);
				const overrides = yield* Schema.decodeEffect(WorkoutExerciseOverridesSchema)(
					membership?.properties ?? {},
				).pipe(Effect.mapError(() => new RyotClientError("malformed-result")));
				const targets = yield* readCursorPages((after) =>
					client.data.query(
						exerciseTargetsRecipe({ after, reference, limit: 100, exerciseId: exercise.id }),
					),
				);
				const equipment = yield* readCursorPages((after) =>
					client.data.query(
						exerciseEquipmentRecipe({ after, reference, limit: 100, exerciseId: exercise.id }),
					),
				);
				return { ...exercise, overrides, targets: targets.items, equipment: equipment.items };
			}),
		{ concurrency: 4 },
	);
});

export type EditorExercise = Effect.Success<ReturnType<typeof readEditorExercises>>[number];

export const editorExercisesQuery = createRyotQuery(
	({
		input,
		client,
	}: {
		readonly client: RyotClient;
		readonly input: { readonly exerciseIds: readonly string[] };
	}) => readEditorExercises(client, input.exerciseIds),
);

export const loadEditorSource = Effect.fnUntraced(function* (
	client: RyotClient,
	input: {
		readonly draftId: string;
		readonly entityId: string;
		readonly kind: "workout" | "template";
	},
) {
	const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
	const entity = yield* client.data.query(
		workoutEditorEntityRecipe({
			reference,
			entityId: input.entityId,
			kind: input.kind === "workout" ? "workout" : "workout-template",
		}),
	);
	if (entity === null) {
		return yield* new RyotClientError("invalid-input");
	}
	const sets =
		input.kind === "workout"
			? (yield* readCursorPages((after) =>
					client.data.query(
						workoutEditorSetsRecipe({ after, reference, workoutId: input.entityId }),
					),
				)).items
			: [];
	const templateExerciseProperties: unknown = entity.properties["exercises"];
	const sourceIds =
		input.kind === "workout"
			? sets.map(({ entityId }) => entityId)
			: yield* Schema.decodeUnknownEffect(
					Schema.Array(Schema.Struct({ exerciseId: Schema.String })),
				)(templateExerciseProperties).pipe(
					Effect.map((rows) => rows.map(({ exerciseId }) => exerciseId)),
					Effect.mapError(() => new RyotClientError("malformed-result")),
				);
	const exercises = yield* readEditorExercises(client, [...new Set(sourceIds)]);
	return hydrateWorkoutEditorSource({ ...input, exercises, baseline: { sets, entity } });
});

export const editorHistoryQuery = createRyotQuery(
	({
		input,
		client,
	}: {
		readonly client: RyotClient;
		readonly input: Omit<Parameters<typeof workoutHistoryRecipe>[0], "reference">;
	}) =>
		client.data.query(
			workoutHistoryRecipe({ ...input, reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
		),
);

export const readHistorySets = Effect.fnUntraced(function* (
	client: RyotClient,
	workoutId: string,
	exerciseId: string,
) {
	const { items } = yield* readCursorPages((after) =>
		client.data.query(
			workoutHistorySetsRecipe({
				after,
				workoutId,
				exerciseId,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
	);
	return items;
});

export const readPreviousSets = Effect.fnUntraced(function* (
	client: RyotClient,
	input: Omit<Parameters<typeof workoutExercisePreviousValuesRecipe>[0], "after" | "reference">,
	count: number,
) {
	const { items } = yield* readCursorPages(
		(after) =>
			client.data.query(
				workoutExercisePreviousValuesRecipe({
					...input,
					after,
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				}),
			),
		{ maxPages: Math.ceil(count / WORKOUT_EDITOR_PAGE_SIZE) },
	);
	return items.slice(0, count);
});
