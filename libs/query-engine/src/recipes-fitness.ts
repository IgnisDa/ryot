import {
	buildQueryEngineEntityRowsDocument,
	queryEngineEntitySource,
	queryEngineInclude,
} from "./documents";
import {
	queryEngineAnd,
	queryEngineComparison,
	queryEngineField,
	queryEngineIdentityFields,
	queryEngineLiteral,
	queryEngineOrder,
	queryEnginePropertyRef,
	queryEngineSystemRef,
} from "./primitives";

const entityAlias = "entity";

const entityWhere = (input: { entityId?: string | undefined; name?: string | undefined }) => {
	const filters = [
		...(input.entityId
			? [
					queryEngineComparison(
						"eq",
						queryEngineSystemRef(entityAlias, "id"),
						queryEngineLiteral(input.entityId),
					),
				]
			: []),
		...(input.name
			? [
					queryEngineComparison(
						"eq",
						queryEngineSystemRef(entityAlias, "name"),
						queryEngineLiteral(input.name),
					),
				]
			: []),
	];
	const [first, ...rest] = filters;
	if (first === undefined) {
		return null;
	}
	return rest.length === 0 ? first : queryEngineAnd(first, ...rest);
};

const workoutFields = (alias: string) =>
	[
		...queryEngineIdentityFields(alias),
		queryEngineField("startedAt", queryEnginePropertyRef(alias, "workout", "startedAt")),
		queryEngineField("endedAt", queryEnginePropertyRef(alias, "workout", "endedAt")),
		queryEngineField("comment", queryEnginePropertyRef(alias, "workout", "comment")),
		queryEngineField("caloriesBurnt", queryEnginePropertyRef(alias, "workout", "caloriesBurnt")),
	] as const;

const workoutTemplateFields = (alias: string) =>
	[
		...queryEngineIdentityFields(alias),
		queryEngineField("createdAt", queryEngineSystemRef(alias, "createdAt")),
		queryEngineField("comment", queryEnginePropertyRef(alias, "workout-template", "comment")),
	] as const;

export const buildExerciseListQueryDocument = (input: {
	entityId?: string | undefined;
	name?: string | undefined;
	page?: number | undefined;
	limit?: number | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		page: input.page,
		limit: input.limit,
		schemas: ["exercise"],
		where: entityWhere(input),
		fields: [
			...queryEngineIdentityFields(entityAlias),
			queryEngineField("image", queryEnginePropertyRef(entityAlias, "exercise", "images", "0")),
			queryEngineField("level", queryEnginePropertyRef(entityAlias, "exercise", "level")),
			queryEngineField("kind", queryEnginePropertyRef(entityAlias, "exercise", "kind")),
			queryEngineField("equipment", queryEnginePropertyRef(entityAlias, "exercise", "equipment")),
		],
	});

export const buildWorkoutListQueryDocument = (input: {
	entityId?: string | undefined;
	page?: number | undefined;
	limit?: number | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		page: input.page,
		limit: input.limit,
		schemas: ["workout"],
		where: entityWhere(input),
		fields: workoutFields(entityAlias),
	});

export const buildMeasurementListQueryDocument = (input: {
	entityId?: string | undefined;
	page?: number | undefined;
	limit?: number | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		page: input.page,
		limit: input.limit,
		schemas: ["measurement"],
		where: entityWhere(input),
		fields: [
			...queryEngineIdentityFields(entityAlias),
			queryEngineField(
				"recordedAt",
				queryEnginePropertyRef(entityAlias, "measurement", "recordedAt"),
			),
			queryEngineField("comment", queryEnginePropertyRef(entityAlias, "measurement", "comment")),
		],
	});

export const buildWorkoutTemplateListQueryDocument = (input: {
	entityId?: string | undefined;
	page?: number | undefined;
	limit?: number | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		page: input.page,
		limit: input.limit,
		schemas: ["workout-template"],
		where: entityWhere(input),
		fields: workoutTemplateFields(entityAlias),
		orderBy: [queryEngineOrder("desc", queryEngineSystemRef(entityAlias, "createdAt"))],
	});

export const buildWorkoutDetailQueryDocument = (input: {
	entityId: string;
	templateLimit: number;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		limit: 1,
		schemas: ["workout"],
		where: entityWhere(input),
		fields: workoutFields(entityAlias),
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
		include: [
			queryEngineInclude({
				key: "template",
				limit: input.templateLimit,
				fields: workoutTemplateFields("template"),
				orderBy: [queryEngineOrder("asc", queryEngineSystemRef("template", "name"))],
				source: queryEngineEntitySource({
					alias: "template",
					schemas: ["workout-template"],
					where: null,
					via: {
						entityRef: entityAlias,
						alias: "templateRelationship",
						direction: "outgoing" as const,
						schema: "workout-to-workout-template",
					},
				}),
			}),
		],
	});

export const buildWorkoutTemplateDetailQueryDocument = (input: {
	entityId: string;
	workoutLimit: number;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		limit: 1,
		schemas: ["workout-template"],
		where: entityWhere(input),
		fields: workoutTemplateFields(entityAlias),
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
		include: [
			queryEngineInclude({
				key: "workouts",
				limit: input.workoutLimit,
				fields: workoutFields("workout"),
				orderBy: [queryEngineOrder("asc", queryEngineSystemRef("workout", "name"))],
				source: queryEngineEntitySource({
					alias: "workout",
					schemas: ["workout"],
					where: null,
					via: {
						entityRef: entityAlias,
						alias: "workoutRelationship",
						direction: "incoming" as const,
						schema: "workout-to-workout-template",
					},
				}),
			}),
		],
	});
