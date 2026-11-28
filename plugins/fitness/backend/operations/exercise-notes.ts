import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { reject } from "@ryot-app/plugin-backend-sdk/operation";
import type { PluginExecutionRequest } from "@ryot-app/plugin-backend-sdk/ryotql";
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
import type { LocalMessage } from "@ryot-app/plugin-kit/messages";

import { catalogMessage } from "../../shared/messages.generated";

type ExecuteRyotql = (request: PluginExecutionRequest) => Effect.Effect<unknown, SandboxHostError>;
const exerciseNoteExerciseRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			exerciseId: {
				type: "string",
				validation: { required: true },
				description: "Exercise Id for this selection",
				label: catalogMessage("query-parameter.exercise"),
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
				validation: { required: true },
				description: "Note Id for this selection",
				label: catalogMessage("query-parameter.note"),
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
const requireFound = (reason: LocalMessage) => (id: string | undefined) =>
	id === undefined ? reject(reason) : Effect.succeed(id);

export const requireExerciseNoteExercise = (exerciseId: string, executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, exerciseNoteExerciseRecipe, { exerciseId: exerciseId }).pipe(
		Effect.flatMap(requireFound(catalogMessage("rejection.exercise-note.missing-exercise"))),
	);

export const requireExerciseNote = (noteId: string, executeRyotql: ExecuteRyotql) =>
	executeRyotqlRecipe(executeRyotql, exerciseNoteEventRecipe, { noteId: noteId }).pipe(
		Effect.flatMap(requireFound(catalogMessage("rejection.exercise-note.missing"))),
	);
