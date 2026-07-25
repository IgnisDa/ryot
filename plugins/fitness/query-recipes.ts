import {
	and,
	ascending,
	castDate,
	castNumber,
	castText,
	column,
	document,
	descending,
	eq,
	field,
	include,
	join,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot/ryotql";

const entityAlias = "entity";

type Table = ReturnType<typeof table>;

const entityIdentityFields = (entity: Table) =>
	[
		field("id", column(entity, "id")),
		field("name", column(entity, "name")),
		field("schemaSlug", column(entity, "entitySchemaSlug")),
	] as const;

const entityWhere = (
	entity: Table,
	schemaSlug: string,
	input: { entityId?: string | undefined; name?: string | undefined },
) => {
	const filters = [
		eq(column(entity, "entitySchemaSlug"), literal(schemaSlug)),
		...(input.entityId ? [eq(column(entity, "id"), literal(input.entityId))] : []),
		...(input.name ? [eq(column(entity, "name"), literal(input.name))] : []),
	];
	return and(...filters);
};

const property = (entity: Table, path: string) =>
	castText(jsonPath(column(entity, "properties"), path));

const propertyDate = (entity: Table, path: string) =>
	castDate(jsonPath(column(entity, "properties"), path));

const propertyNumber = (entity: Table, path: string) =>
	castNumber(jsonPath(column(entity, "properties"), path));

const workoutFields = (entity: Table) =>
	[
		...entityIdentityFields(entity),
		field("startedAt", propertyDate(entity, "startedAt")),
		field("endedAt", propertyDate(entity, "endedAt")),
		field("comment", property(entity, "comment")),
		field("caloriesBurnt", propertyNumber(entity, "caloriesBurnt")),
	] as const;

const workoutTemplateFields = (entity: Table) =>
	[
		...entityIdentityFields(entity),
		field("createdAt", column(entity, "createdAt")),
		field("comment", property(entity, "comment")),
	] as const;

const workoutTemplateInclude = (parent: Table, limit: number) => {
	const template = table("entity", "template");
	const relationship = table("relationship", "templateRelationship");
	return include(relationship, {
		limit,
		key: "template",
		fields: workoutTemplateFields(template),
		orderBy: [ascending(column(template, "name"))],
		joins: [
			join("inner", template, eq(column(relationship, "targetEntityId"), column(template, "id"))),
		],
		where: and(
			eq(column(relationship, "sourceEntityId"), column(parent, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal("workout-to-workout-template")),
			eq(column(template, "entitySchemaSlug"), literal("workout-template")),
		),
	});
};

const workoutInclude = (parent: Table, limit: number) => {
	const workout = table("entity", "workout");
	const relationship = table("relationship", "workoutRelationship");
	return include(relationship, {
		limit,
		key: "workouts",
		fields: workoutFields(workout),
		orderBy: [ascending(column(workout, "name"))],
		joins: [
			join("inner", workout, eq(column(relationship, "sourceEntityId"), column(workout, "id"))),
		],
		where: and(
			eq(column(relationship, "targetEntityId"), column(parent, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal("workout-to-workout-template")),
			eq(column(workout, "entitySchemaSlug"), literal("workout")),
		),
	});
};

export const buildExerciseListQueryDocument = (input: {
	name?: string | undefined;
	page?: number | undefined;
	limit?: number | undefined;
	entityId?: string | undefined;
}) => {
	const entity = table("entity", entityAlias);
	return document({
		exercises: rows(entity, {
			page: input.page,
			limit: input.limit,
			where: entityWhere(entity, "exercise", input),
			orderBy: [ascending(column(entity, "name"))],
			fields: [
				...entityIdentityFields(entity),
				field("image", jsonPath(column(entity, "properties"), "images", 0)),
				field("level", property(entity, "level")),
				field("kind", property(entity, "kind")),
				field("equipment", property(entity, "equipment")),
			],
		}),
	});
};

export const buildWorkoutListQueryDocument = (input: {
	page?: number | undefined;
	limit?: number | undefined;
	entityId?: string | undefined;
}) => {
	const entity = table("entity", entityAlias);
	return document({
		workouts: rows(entity, {
			page: input.page,
			limit: input.limit,
			fields: workoutFields(entity),
			where: entityWhere(entity, "workout", input),
			orderBy: [ascending(column(entity, "name"))],
		}),
	});
};

export const buildMeasurementListQueryDocument = (input: {
	page?: number | undefined;
	limit?: number | undefined;
	entityId?: string | undefined;
}) => {
	const entity = table("entity", entityAlias);
	return document({
		measurements: rows(entity, {
			page: input.page,
			limit: input.limit,
			where: entityWhere(entity, "measurement", input),
			orderBy: [ascending(column(entity, "name"))],
			fields: [
				...entityIdentityFields(entity),
				field("recordedAt", propertyDate(entity, "recordedAt")),
				field("comment", property(entity, "comment")),
			],
		}),
	});
};

export const buildWorkoutTemplateListQueryDocument = (input: {
	page?: number | undefined;
	limit?: number | undefined;
	entityId?: string | undefined;
}) => {
	const entity = table("entity", entityAlias);
	return document({
		workoutTemplates: rows(entity, {
			page: input.page,
			limit: input.limit,
			fields: workoutTemplateFields(entity),
			where: entityWhere(entity, "workout-template", input),
			orderBy: [descending(column(entity, "createdAt"))],
		}),
	});
};

export const buildWorkoutDetailQueryDocument = (input: {
	entityId: string;
	templateLimit: number;
}) => {
	const entity = table("entity", entityAlias);
	return document({
		workout: rows(entity, {
			limit: 1,
			fields: workoutFields(entity),
			where: entityWhere(entity, "workout", input),
			orderBy: [ascending(column(entity, "id"))],
			include: [workoutTemplateInclude(entity, input.templateLimit)],
		}),
	});
};

export const buildWorkoutTemplateDetailQueryDocument = (input: {
	entityId: string;
	workoutLimit: number;
}) => {
	const entity = table("entity", entityAlias);
	return document({
		workoutTemplate: rows(entity, {
			limit: 1,
			fields: workoutTemplateFields(entity),
			where: entityWhere(entity, "workout-template", input),
			orderBy: [ascending(column(entity, "id"))],
			include: [workoutInclude(entity, input.workoutLimit)],
		}),
	});
};
