import {
	exerciseOverrideUpdateRecipe,
	workoutDeleteRecipe,
	workoutEditorContextRecipe,
	workoutEditorSaveRecipe,
	workoutTimeCorrectionRecipe,
} from "@ryot-app/fitness-plugin/contracts/operation-recipes";
import {
	encodeWorkoutEditorBaseline,
	type WorkoutEditorBaseline,
	workoutEditorEntityRecipe,
	workoutEditorSetsRecipe,
} from "@ryot-app/fitness-plugin/workout-editor-recipes";
import { Effect } from "effect";

import { collectRyotQLRecipeItems, executeRyotQLRecipe } from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import { requirePresent } from "~/support/assertions";

import { findFitnessEntitySchema } from "./exercises";
import { invokeFitnessOperation, type RecipeInput } from "./operation-transport";

export const workoutEditorTimes = {
	endedAt: "2026-10-01T11:00:00.000Z",
	startedAt: "2026-10-01T10:00:00.000Z",
	setOccurredAt: "2026-10-01T10:15:00.000Z",
};

export const saveWorkoutEditor = (
	client: Client,
	input: RecipeInput<typeof workoutEditorSaveRecipe>,
) => invokeFitnessOperation(client, workoutEditorSaveRecipe, input);

export const loadWorkoutEditorContext = (
	client: Client,
	input: RecipeInput<typeof workoutEditorContextRecipe>,
) => invokeFitnessOperation(client, workoutEditorContextRecipe, input);

export const correctWorkoutTimes = (
	client: Client,
	input: RecipeInput<typeof workoutTimeCorrectionRecipe>,
) => invokeFitnessOperation(client, workoutTimeCorrectionRecipe, input);

export const deleteWorkout = (client: Client, input: RecipeInput<typeof workoutDeleteRecipe>) =>
	invokeFitnessOperation(client, workoutDeleteRecipe, input);

export const updateExerciseOverrides = (
	client: Client,
	input: RecipeInput<typeof exerciseOverrideUpdateRecipe>,
) => invokeFitnessOperation(client, exerciseOverrideUpdateRecipe, input);

export type SaveInput = RecipeInput<typeof workoutEditorSaveRecipe>;
export type WorkoutData = Extract<SaveInput["data"], { kind: "workout" }>;
export type WorkoutOccurrenceInput = WorkoutData["occurrences"][number];
export type WorkoutSetInput = WorkoutOccurrenceInput["sets"][number];
export type TemplateData = Extract<SaveInput["data"], { kind: "template" }>;

export const workoutReference = (client: Client) =>
	findFitnessEntitySchema(client, "workout").pipe(
		Effect.map(({ pluginId }) => ({ pluginId, kind: "local" as const })),
	);

export const loadWorkoutBaseline = (
	client: Client,
	entityId: string,
	kind: "workout" | "workout-template" = "workout",
) =>
	Effect.gen(function* () {
		const reference = yield* workoutReference(client);
		const entity = requirePresent(
			yield* executeRyotQLRecipe(client, workoutEditorEntityRecipe({ kind, entityId, reference })),
			`Expected workout editor entity ${entityId}`,
		);
		const sets = yield* collectRyotQLRecipeItems(client, (after) =>
			workoutEditorSetsRecipe({ after, reference, workoutId: entityId }),
		);
		const baseline: WorkoutEditorBaseline = { sets, entity };
		return { baseline, conflictToken: encodeWorkoutEditorBaseline(baseline) };
	});

export const editTarget = (loaded: {
	readonly baseline: WorkoutEditorBaseline;
	readonly conflictToken: string;
}) => ({
	kind: "update" as const,
	conflictToken: loaded.conflictToken,
	entityId: loaded.baseline.entity.id,
});

export const workoutData = (overrides: Partial<WorkoutData> = {}): WorkoutData => ({
	images: [],
	videos: [],
	supersets: [],
	kind: "workout",
	occurrences: [],
	target: { kind: "create" },
	activeDuration: { kind: "preserve" },
	startedAt: workoutEditorTimes.startedAt,
	name: `Workout Editor ${crypto.randomUUID()}`,
	...overrides,
});

export const workoutSet = (overrides: Partial<WorkoutSetInput> = {}): WorkoutSetInput => ({
	setLot: "normal",
	exerciseKind: "reps_and_weight",
	measurements: { reps: 0, weight: 0 },
	clientId: `set-${crypto.randomUUID()}`,
	occurredAt: workoutEditorTimes.setOccurredAt,
	confirmedAt: workoutEditorTimes.setOccurredAt,
	...overrides,
});

export const keepSet = (
	set: Pick<WorkoutEditorBaseline["sets"][number], "id" | "occurredAt">,
	overrides: Partial<WorkoutSetInput> = {},
) => workoutSet({ eventId: set.id, occurredAt: set.occurredAt, ...overrides });

export const workoutOccurrence = (
	exerciseId: WorkoutOccurrenceInput["exerciseId"],
	sets: WorkoutSetInput[],
	overrides: Partial<WorkoutOccurrenceInput> = {},
): WorkoutOccurrenceInput => ({
	sets,
	notes: [],
	images: [],
	videos: [],
	exerciseId,
	clientId: `occurrence-${crypto.randomUUID()}`,
	...overrides,
});

export const templateData = (overrides: Partial<TemplateData> = {}): TemplateData => ({
	images: [],
	videos: [],
	supersets: [],
	occurrences: [],
	kind: "template",
	target: { kind: "create" },
	name: `Workout Template ${crypto.randomUUID()}`,
	...overrides,
});

export const operationInput = (
	data: SaveInput["data"],
	submissionId: SaveInput["submissionId"] = crypto.randomUUID(),
	submittedAt = new Date().toISOString(),
): SaveInput => ({ data, submittedAt, submissionId });

export const saveWorkoutData = (
	client: Client,
	data: SaveInput["data"],
	submissionId?: SaveInput["submissionId"],
) => saveWorkoutEditor(client, operationInput(data, submissionId));
