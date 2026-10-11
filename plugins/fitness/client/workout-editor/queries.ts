import { RyotClientError, type RyotClient } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { exerciseEquipmentRecipe, exerciseTargetsRecipe } from "../../shared/taxonomy-recipes";
import { WorkoutExerciseOverridesSchema } from "../../shared/workout-editor-preferences";
import {
	workoutEditorEntityRecipe,
	workoutEditorExercisesRecipe,
	workoutEditorMembershipRecipe,
	workoutEditorSetsRecipe,
	type WorkoutEditorExercise,
} from "../../shared/workout-editor-recipes";
import { hydrateWorkoutEditorSource } from "../../shared/workout-editor-source";
import type { WorkoutExercisePickerResult } from "../../shared/workout-exercise-recipes";
import {
	workoutExercisePreviousValuesRecipe,
	workoutHistoryRecipe,
	workoutHistorySetsRecipe,
	type WorkoutExercisePreviousValuesResult,
} from "../../shared/workout-history-recipes";

export const readEditorPages = <A>(
	read: (
		after?: string,
	) => Effect.Effect<
		{ readonly items: readonly A[]; readonly pageInfo: WorkoutExercisePickerResult["pageInfo"] },
		RyotClientError
	>,
) =>
	Effect.gen(function* () {
		const items: A[] = [];
		const cursors = new Set<string>();
		let after: string | undefined;
		for (;;) {
			const page = yield* read(after);
			items.push(...page.items);
			if (!page.pageInfo.hasMore) {
				return items;
			}
			const next = page.pageInfo.nextCursor;
			if (next === null || cursors.has(next)) {
				return yield* new RyotClientError("malformed-result");
			}
			cursors.add(next);
			after = next;
		}
	});

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
		exercises.push(
			...(yield* readEditorPages((after) =>
				client.data.query(
					workoutEditorExercisesRecipe({
						after,
						reference,
						exerciseIds: exerciseIds.slice(offset, offset + 100),
					}),
				),
			)),
		);
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
				const targets = yield* readEditorPages((after) =>
					client.data.query(
						exerciseTargetsRecipe({ after, reference, limit: 100, exerciseId: exercise.id }),
					),
				);
				const equipment = yield* readEditorPages((after) =>
					client.data.query(
						exerciseEquipmentRecipe({ after, reference, limit: 100, exerciseId: exercise.id }),
					),
				);
				return { ...exercise, targets, overrides, equipment };
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
		readonly entityId: string;
		readonly kind: "workout" | "template";
		readonly draftId: string;
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
			? yield* readEditorPages((after) =>
					client.data.query(
						workoutEditorSetsRecipe({ after, reference, workoutId: input.entityId }),
					),
				)
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
	return yield* readEditorPages((after) =>
		client.data.query(
			workoutHistorySetsRecipe({
				after,
				workoutId,
				exerciseId,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
	);
});

export const readPreviousSets = Effect.fnUntraced(function* (
	client: RyotClient,
	input: Omit<Parameters<typeof workoutExercisePreviousValuesRecipe>[0], "reference" | "after">,
	count: number,
) {
	const sets: WorkoutExercisePreviousValuesResult["items"][number][] = [];
	const cursors = new Set<string>();
	let after: string | undefined;
	while (sets.length < count) {
		const page = yield* client.data.query(
			workoutExercisePreviousValuesRecipe({
				...input,
				after,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		);
		sets.push(...page.items);
		if (!page.pageInfo.hasMore) {
			break;
		}
		const next = page.pageInfo.nextCursor;
		if (next === null || cursors.has(next)) {
			return yield* new RyotClientError("malformed-result");
		}
		cursors.add(next);
		after = next;
	}
	return sets.slice(0, count);
});
