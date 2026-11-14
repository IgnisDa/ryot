import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { ExecutionRequest } from "@ryot-app/plugin-backend-sdk/ryotql";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	eventSchemaPredicate,
	executeRyotqlRecipe,
	join,
	parameters,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";

type ExecuteRyotql = (request: ExecutionRequest) => Effect.Effect<unknown, SandboxHostError>;
export class ExerciseNoteNotFoundError extends Schema.TaggedError<
	ExerciseNoteNotFoundError,
	{ readonly brand: unique symbol }
>()("ExerciseNoteNotFoundError", { message: Schema.String }) {}
const exerciseNoteExerciseRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			exerciseId: {
				type: "string",
				label: "Exercise Id",
				validation: { required: true },
				description: "Exercise Id for this selection",
			},
		},
	});
	const exercise = table("entity", "exerciseNoteExercise");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ exercise: row }) => Result.succeed(row?.id),
		queries: {
			exercise: selectedOptionalRow(exercise, {
				orderBy: [ascending(column(exercise, "id"))],
				selection: { id: selectedField(column(exercise, "id"), Schema.String) },
				where: and(
					eq(column(exercise, "id"), inputParameters.value("exerciseId")),
					entitySchemaPredicate(exercise, "exercise", { kind: "self" }),
				),
			}),
		},
	});
})();
const exerciseNoteEventRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			noteId: {
				type: "string",
				label: "Note Id",
				validation: { required: true },
				description: "Note Id for this selection",
			},
		},
	});
	const note = table("event", "exerciseNote");
	const exercise = table("entity", "exerciseNoteExercise");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ note: row }) => Result.succeed(row?.id),
		queries: {
			note: selectedOptionalRow(note, {
				orderBy: [ascending(column(note, "id"))],
				selection: { id: selectedField(column(note, "id"), Schema.String) },
				joins: [join("inner", exercise, eq(column(note, "entityId"), column(exercise, "id")))],
				where: and(
					eq(column(note, "id"), inputParameters.value("noteId")),
					eventSchemaPredicate(note, exercise, "exercise", "review", { kind: "self" }),
				),
			}),
		},
	});
})();
const requireFound = (message: string) => (id: string | undefined) =>
	id === undefined
		? Effect.fail(new ExerciseNoteNotFoundError({ message: message }))
		: Effect.succeed(id);

export const requireExerciseNoteExercise = (exerciseId: string, executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, exerciseNoteExerciseRecipe, { exerciseId: exerciseId }).pipe(
		Effect.flatMap(requireFound("Exercise not found")),
	);

export const requireExerciseNote = (noteId: string, executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, exerciseNoteEventRecipe, { noteId: noteId }).pipe(
		Effect.flatMap(requireFound("Exercise note not found")),
	);
