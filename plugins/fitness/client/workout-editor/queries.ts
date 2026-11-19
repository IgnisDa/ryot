import { readCursorPages, type RyotClient, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

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
				workoutEditorExercisesRecipe({ reference: reference }),
				{ exerciseIds: exerciseIds.slice(offset, offset + 100) },
				{ pages: { exercises: { after: after } } },
			),
		);
		exercises.push(...page.items);
	}
	return yield* Effect.forEach(
		exercises,
		(exercise) =>
			Effect.gen(function* () {
				const membership = yield* client.data.query(
					workoutEditorMembershipRecipe({ reference: reference }),
					{ exerciseId: exercise.id },
				);
				const overrides = yield* Schema.decodeEffect(WorkoutExerciseOverridesSchema)(
					membership?.properties ?? {},
				).pipe(Effect.mapError(() => new RyotClientError({ reason: "malformed-result" })));
				const targets = yield* readCursorPages((after) =>
					client.data.query(
						exerciseTargetsRecipe({ reference: reference }),
						{ exerciseId: exercise.id },
						{ pages: { targets: { limit: 100, after: after } } },
					),
				);
				const equipment = yield* readCursorPages((after) =>
					client.data.query(
						exerciseEquipmentRecipe({ reference: reference }),
						{ exerciseId: exercise.id },
						{ pages: { equipment: { limit: 100, after: after } } },
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
	const entity = yield* client.data.query(workoutEditorEntityRecipe({ reference: reference }), {
		entityId: input.entityId,
		kind: input.kind === "workout" ? "workout" : "workout-template",
	});
	if (entity === null) {
		return yield* new RyotClientError({ reason: "invalid-input" });
	}
	const sets =
		input.kind === "workout"
			? (yield* readCursorPages((after) =>
					client.data.query(
						workoutEditorSetsRecipe({ reference: reference }),
						{ workoutId: input.entityId },
						{ pages: { sets: { after: after } } },
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
					Effect.mapBoth({
						onSuccess: (rows) => rows.map(({ exerciseId }) => exerciseId),
						onFailure: () => new RyotClientError({ reason: "malformed-result" }),
					}),
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
		readonly input: Omit<
			{ after?: string | undefined } & Parameters<typeof workoutHistoryRecipe>[0] &
				Recipe.Arguments<ReturnType<typeof workoutHistoryRecipe>>,
			"reference"
		>;
	}) =>
		client.data.query(
			workoutHistoryRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
			{
				exerciseId: input.exerciseId,
				beforeStartedAt: input.beforeStartedAt,
				excludeWorkoutId: input.excludeWorkoutId,
			},
			{ pages: { workouts: { after: input.after } } },
		),
);

export const readHistorySets = Effect.fnUntraced(function* (
	client: RyotClient,
	workoutId: string,
	exerciseId: string,
) {
	const { items } = yield* readCursorPages((after) =>
		client.data.query(
			workoutHistorySetsRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
			{ workoutId, exerciseId },
			{ pages: { sets: { after: after } } },
		),
	);
	return items;
});

export const readPreviousSets = Effect.fnUntraced(function* (
	client: RyotClient,
	input: Omit<
		Parameters<typeof workoutExercisePreviousValuesRecipe>[0] & {
			after?: string | undefined;
			limit?: number | undefined;
		} & Recipe.Arguments<ReturnType<typeof workoutExercisePreviousValuesRecipe>>,
		"after" | "reference"
	>,
	count: number,
) {
	const { items } = yield* readCursorPages(
		(after) =>
			client.data.query(
				workoutExercisePreviousValuesRecipe({
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				}),
				{
					exerciseId: input.exerciseId,
					recordedKind: input.recordedKind,
					beforeStartedAt: input.beforeStartedAt,
					excludeWorkoutId: input.excludeWorkoutId,
				},
				{ pages: { sets: { after: after, limit: input.limit } } },
			),
		{ maxPages: Math.ceil(count / WORKOUT_EDITOR_PAGE_SIZE) },
	);
	return items.slice(0, count);
});
