import { type RyotClient, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { exerciseKindSchema } from "../../shared/exercise-kinds";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { workoutEditorEntityRecipe } from "../../shared/workout-editor-recipes";
import { normalizeTemplatePlan } from "../../shared/workout-editor-source";
import { type EditorExercise, readEditorExercises } from "../workout-editor/queries";

export type TemplateExercise = EditorExercise & {
	readonly exerciseKind: typeof exerciseKindSchema.Type;
};

const loadTemplate = Effect.fnUntraced(function* (client: RyotClient, entityId: string) {
	const entity = yield* client.data.query(
		workoutEditorEntityRecipe({
			entityId,
			kind: "workout-template",
			reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
		}),
	);
	if (entity === null) {
		return yield* new RyotClientError("invalid-input");
	}
	const plan = normalizeTemplatePlan(entity.properties);
	if (plan === undefined) {
		return { kind: "blocked" } as const;
	}
	const exercises = yield* readEditorExercises(client, [
		...new Set(plan.exercises.map(({ exerciseId }) => exerciseId)),
	]);
	const enriched: TemplateExercise[] = [];
	for (const exercise of exercises) {
		const kind = Schema.decodeUnknownResult(exerciseKindSchema)(exercise.properties["kind"]);
		if (kind._tag === "Failure") {
			return { kind: "blocked" } as const;
		}
		enriched.push({ ...exercise, exerciseKind: kind.success });
	}
	if (plan.exercises.some(({ exerciseId }) => !enriched.some(({ id }) => id === exerciseId))) {
		return { kind: "blocked" } as const;
	}
	return { plan, entity, kind: "ready", exercises: enriched } as const;
});

export const templateQuery = createRyotQuery(
	({ input, client }: { readonly client: RyotClient; readonly input: string }) =>
		loadTemplate(client, input),
	{ entityWatch: ({ input }) => ({ visible: [], foreground: [input] }) },
);
