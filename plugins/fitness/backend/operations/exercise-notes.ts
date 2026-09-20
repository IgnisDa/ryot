import type { UpdateEventItem } from "@ryot-app/sandbox-sdk/core";
import { Effect, Result, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	executeRyotqlRecipe,
	join,
	literal,
	selectedField,
	selectedOptionalRow,
	table,
	type RyotQLDocument,
	entitySchemaPredicate,
	eventSchemaPredicate,
} from "@ryot-app/sandbox-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/sandbox-sdk/wire";

import type { ExerciseNoteUpdateInput } from "../../shared/exercise-note-operations";

type ExecuteRyotql = (document: RyotQLDocument) => Effect.Effect<unknown, SandboxHostError>;

export class ExerciseNoteNotFoundError extends Error {
	readonly _tag = "ExerciseNoteNotFoundError";
}

const exerciseNoteExerciseRecipe = defineRecipe((exerciseId: string) => {
	const exercise = table("entity", "exerciseNoteExercise");
	return {
		map: ({ exercise: row }) => Result.succeed(row?.id),
		queries: {
			exercise: selectedOptionalRow(exercise, {
				orderBy: [ascending(column(exercise, "id"))],
				selection: { id: selectedField(column(exercise, "id"), Schema.String) },
				where: and(
					eq(column(exercise, "id"), literal(exerciseId)),
					entitySchemaPredicate(exercise, "exercise", { kind: "self" }),
				),
			}),
		},
	};
});

const exerciseNoteEventRecipe = defineRecipe((noteId: string) => {
	const note = table("event", "exerciseNote");
	const exercise = table("entity", "exerciseNoteExercise");
	return {
		map: ({ note: row }) => Result.succeed(row?.id),
		queries: {
			note: selectedOptionalRow(note, {
				orderBy: [ascending(column(note, "id"))],
				selection: { id: selectedField(column(note, "id"), Schema.String) },
				joins: [join("inner", exercise, eq(column(note, "entityId"), column(exercise, "id")))],
				where: and(
					eq(column(note, "id"), literal(noteId)),
					eventSchemaPredicate(note, exercise, "exercise", "review", { kind: "self" }),
				),
			}),
		},
	};
});

const requireFound = (message: string) => (id: string | undefined) =>
	id === undefined ? Effect.fail(new ExerciseNoteNotFoundError(message)) : Effect.succeed(id);

export const requireExerciseNoteExercise = (exerciseId: string, executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, exerciseNoteExerciseRecipe(exerciseId)).pipe(
		Effect.flatMap(requireFound("Exercise not found")),
	);

export const requireExerciseNote = (noteId: string, executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, exerciseNoteEventRecipe(noteId)).pipe(
		Effect.flatMap(requireFound("Exercise note not found")),
	);

export const exerciseNotePropertiesPatch = (
	input: ExerciseNoteUpdateInput,
): NonNullable<UpdateEventItem["patch"]["properties"]> =>
	input.rating === null
		? { remove: ["rating"], set: { text: input.text } }
		: { remove: [], set: { text: input.text, rating: input.rating } };
