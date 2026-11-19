import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	coalesce,
	column,
	defineRecipe,
	eq,
	gt,
	gte,
	inArray,
	join,
	literal,
	lte,
	not,
	or,
	parameters,
	type Predicate,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";
import { EventId } from "@ryot-app/plugin-kit/schema";

import { projectionNumber, property, propertyDate, propertyNumber } from "./entity-selections";
import { type ExerciseKind, exerciseKindSchema } from "./exercise-kinds";
import { catalogMessage } from "./messages.generated";
import type { PersonalBest } from "./workout-records";

const workoutRecordPageSize = 100;
const unorderedLast = 2147483647;
const boundTolerance = 0.001;

/** Sets after `from` whose personal-best candidate may lie in one of `bounds`; callers recheck exactly. */
export type WorkoutRecordRange = {
	readonly from: string;
	readonly excluded: ReadonlyArray<string>;
	readonly bounds: ReadonlyArray<{
		readonly above: number;
		readonly atMost: number;
		readonly kind: ExerciseKind;
		readonly type: PersonalBest;
	}>;
};

type Table = Parameters<typeof column>[0];

const candidateExpressions: Record<
	PersonalBest,
	(event: Table) => ReturnType<typeof propertyNumber>
> = {
	reps: (event) => propertyNumber(event, "reps"),
	pace: (event) => projectionNumber(event, "pace"),
	time: (event) => propertyNumber(event, "duration"),
	weight: (event) => propertyNumber(event, "weight"),
	one_rm: (event) => projectionNumber(event, "oneRm"),
	volume: (event) => projectionNumber(event, "volume"),
	distance: (event) => propertyNumber(event, "distance"),
};

const candidateExpression = (event: Table, type: PersonalBest) => candidateExpressions[type](event);

const rangePredicate = (event: Table, range: WorkoutRecordRange): Predicate =>
	and(
		gte(column(event, "occurredAt"), castDate(literal(range.from))),
		not(inArray(column(event, "id"), range.excluded.map(literal))),
		or(
			...range.bounds.map(({ kind, type, above, atMost }) =>
				and(
					eq(property(event, "exerciseKind"), literal(kind)),
					gt(candidateExpression(event, type), literal(above - boundTolerance)),
					lte(candidateExpression(event, type), literal(atMost + boundTolerance)),
				),
			),
		),
	);

export const workoutRecordPageRecipe = (input: {
	readonly range?: WorkoutRecordRange;
	readonly reference: PluginIdentityReference;
}) => {
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
	const event = table("event", "workoutRecord");
	const exercise = table("entity", "exercise");
	const workout = table("entity", "workout");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ records }) => Result.succeed(records),
		queries: {
			records: selectedRows(event, {
				limit: workoutRecordPageSize,
				joins: [
					join("inner", exercise, eq(column(event, "entityId"), column(exercise, "id"))),
					join("inner", workout, eq(column(event, "sessionEntityId"), column(workout, "id"))),
				],
				orderBy: [
					ascending(column(event, "occurredAt")),
					ascending(propertyDate(workout, "startedAt")),
					ascending(column(event, "sessionEntityId")),
					ascending(coalesce(propertyNumber(event, "exerciseOrder"), literal(unorderedLast))),
					ascending(coalesce(propertyNumber(event, "setOrder"), literal(unorderedLast))),
					ascending(column(event, "id")),
				],
				where: and(
					schemaOwnerPredicate(exercise, "entitySchemaPluginId", input.reference),
					schemaOwnerPredicate(workout, "entitySchemaPluginId", input.reference),
					schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
					eq(column(event, "entityId"), inputParameters.value("exerciseId")),
					eq(column(event, "eventSchemaSlug"), literal("workout-set")),
					eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
					eq(column(workout, "entitySchemaSlug"), literal("workout")),
					...(input.range === undefined ? [] : [rangePredicate(event, input.range)]),
				),
				selection: {
					id: selectedField(column(event, "id"), EventId),
					occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
					sessionEntityId: selectedField(column(event, "sessionEntityId"), Schema.String),
					exerciseKind: selectedField(property(event, "exerciseKind"), exerciseKindSchema),
					reps: selectedField(propertyNumber(event, "reps"), Schema.NullOr(Schema.Finite)),
					weight: selectedField(propertyNumber(event, "weight"), Schema.NullOr(Schema.Finite)),
					setOrder: selectedField(propertyNumber(event, "setOrder"), Schema.NullOr(Schema.Finite)),
					duration: selectedField(propertyNumber(event, "duration"), Schema.NullOr(Schema.Finite)),
					distance: selectedField(propertyNumber(event, "distance"), Schema.NullOr(Schema.Finite)),
					startedAt: selectedField(
						propertyDate(workout, "startedAt"),
						Schema.NullOr(Schema.String),
					),
					exerciseOrder: selectedField(
						propertyNumber(event, "exerciseOrder"),
						Schema.NullOr(Schema.Finite),
					),
				},
			}),
		},
	});
};

/** The start of each listed workout, as the record order reads it. */
export const workoutStartsRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			workoutIds: {
				type: "array",
				validation: { required: true },
				description: "Workout Ids for this selection",
				label: catalogMessage("query-parameter.workouts"),
				items: {
					type: "string",
					description: "Selection value",
					label: catalogMessage("query-parameter.value"),
				},
			},
		},
	});
	const workout = table("entity", "workout");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ workouts }) => Result.succeed(workouts),
		queries: {
			workouts: selectedRows(workout, {
				limit: workoutRecordPageSize,
				orderBy: [ascending(column(workout, "id"))],
				selection: {
					id: selectedField(column(workout, "id"), Schema.String),
					startedAt: selectedField(
						propertyDate(workout, "startedAt"),
						Schema.NullOr(Schema.String),
					),
				},
				where: and(
					schemaOwnerPredicate(workout, "entitySchemaPluginId", input.reference),
					eq(column(workout, "entitySchemaSlug"), literal("workout")),
					inArray(column(workout, "id"), inputParameters.list("workoutIds")),
				),
			}),
		},
	});
};
