import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	inArray,
	isNotNull,
	JsonValue,
	literal,
	parameters,
	type Recipe,
	relationshipSchemaPredicate,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EventId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { propertyJson } from "./entity-selections";
import { decodeWorkoutEditorJson, encodeWorkoutEditorJson } from "./workout-editor-codec";
import { WorkoutEditorMediaSchema, workoutSetEditableFields } from "./workout-set";

export const WORKOUT_EDITOR_PAGE_SIZE = 100;

export const WorkoutEditorPropertiesSchema = Schema.Record(Schema.String, JsonValue);
const WorkoutEditorEntitySchema = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	updatedAt: Schema.String,
	properties: WorkoutEditorPropertiesSchema,
});
const WorkoutEditorEventSchema = Schema.Struct({
	id: EventId,
	entityId: EntityId,
	occurredAt: Schema.String,
	sessionEntityId: EntityId,
	properties: WorkoutEditorPropertiesSchema,
});
export const WorkoutEditorBaselineSchema = Schema.Struct({
	entity: WorkoutEditorEntitySchema,
	sets: Schema.Array(WorkoutEditorEventSchema),
});
export type WorkoutEditorEvent = typeof WorkoutEditorEventSchema.Type;
export type WorkoutEditorBaseline = typeof WorkoutEditorBaselineSchema.Type;
export const workoutEditorEntityRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "entityId",
				validation: { required: true },
				description: "entityId for this selection",
			},
			kind: {
				type: "enum",
				label: "kind",
				validation: { required: true },
				description: "kind for this selection",
				choices: {
					kind: "static",
					values: [
						{ value: "workout", label: "workout" },
						{ value: "workout-template", label: "workout-template" },
					],
				},
			},
		},
	});
	const entity = table("entity", "editorEntity");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ entity: result }) => Result.succeed(result ?? null),
		queries: {
			entity: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				where: and(
					and(
						schemaOwnerPredicate(entity, "entitySchemaPluginId", input.reference),
						eq(column(entity, "entitySchemaSlug"), inputParameters.value("kind")),
					),
					eq(column(entity, "id"), inputParameters.value("entityId")),
				),
				selection: {
					id: selectedField(column(entity, "id"), EntityId),
					name: selectedField(column(entity, "name"), Schema.String),
					updatedAt: selectedField(column(entity, "updatedAt"), Schema.String),
					properties: selectedField(column(entity, "properties"), WorkoutEditorPropertiesSchema),
				},
			}),
		},
	});
};
export const workoutEditorSetsRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			workoutId: {
				type: "string",
				label: "Workout Id",
				validation: { required: true },
				description: "Workout Id for this selection",
			},
		},
	});
	const event = table("event", "editorSet");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ sets }) => Result.succeed(sets),
		queries: {
			sets: selectedRows(event, {
				limit: WORKOUT_EDITOR_PAGE_SIZE,
				orderBy: [ascending(column(event, "id"))],
				where: and(
					schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
					eq(column(event, "eventSchemaSlug"), literal("workout-set")),
					eq(column(event, "sessionEntityId"), inputParameters.value("workoutId")),
				),
				selection: {
					id: selectedField(column(event, "id"), EventId),
					entityId: selectedField(column(event, "entityId"), EntityId),
					occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
					sessionEntityId: selectedField(column(event, "sessionEntityId"), EntityId),
					properties: selectedField(column(event, "properties"), WorkoutEditorPropertiesSchema),
				},
			}),
		},
	});
};
export const workoutEditorExercisesRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			exerciseIds: {
				type: "array",
				label: "Exercise Ids",
				validation: { required: true },
				description: "Exercise Ids for this selection",
				items: { type: "string", label: "Value", description: "Selection value" },
			},
		},
	});
	const exercise = table("entity", "editorExercise");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ exercises }) => Result.succeed(exercises),
		queries: {
			exercises: selectedRows(exercise, {
				limit: WORKOUT_EDITOR_PAGE_SIZE,
				orderBy: [ascending(column(exercise, "id"))],
				where: and(
					entitySchemaPredicate(exercise, "exercise", input.reference),
					inArray(column(exercise, "id"), inputParameters.list("exerciseIds")),
				),
				selection: {
					id: selectedField(column(exercise, "id"), EntityId),
					name: selectedField(column(exercise, "name"), Schema.String),
					properties: selectedField(column(exercise, "properties"), WorkoutEditorPropertiesSchema),
					images: selectedField(
						propertyJson(exercise, "images"),
						Schema.NullOr(WorkoutEditorMediaSchema),
					),
					instructions: selectedField(
						propertyJson(exercise, "instructions"),
						Schema.NullOr(Schema.Array(Schema.String)),
					),
				},
			}),
		},
	});
};
export const workoutEditorEventIdentitiesRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			eventIds: {
				type: "array",
				label: "Event Ids",
				validation: { required: true },
				description: "Event Ids for this selection",
				items: { type: "string", label: "Value", description: "Selection value" },
			},
		},
	});
	const event = table("event", "editorEventIdentity");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ identities }) => Result.succeed(identities.items),
		queries: {
			identities: selectedRows(event, {
				limit: WORKOUT_EDITOR_PAGE_SIZE,
				orderBy: [ascending(column(event, "id"))],
				where: and(
					schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
					inArray(column(event, "id"), inputParameters.list("eventIds")),
				),
				selection: {
					id: selectedField(column(event, "id"), EventId),
					entityId: selectedField(column(event, "entityId"), EntityId),
					slug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
					sessionEntityId: selectedField(column(event, "sessionEntityId"), Schema.NullOr(EntityId)),
				},
			}),
		},
	});
};
export const workoutEditorMembershipRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
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
	const link = table("relationship", "editorMembership");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ membership }) => Result.succeed(membership ?? null),
		queries: {
			membership: selectedOptionalRow(link, {
				orderBy: [ascending(column(link, "id"))],
				where: and(
					relationshipSchemaPredicate(link, "in-fitness-library", input.reference),
					isNotNull(column(link, "userId")),
					eq(column(link, "sourceEntityId"), inputParameters.value("exerciseId")),
				),
				selection: {
					id: selectedField(column(link, "id"), Schema.String),
					targetEntityId: selectedField(column(link, "targetEntityId"), EntityId),
					properties: selectedField(column(link, "properties"), WorkoutEditorPropertiesSchema),
				},
			}),
		},
	});
};
export const workoutEditorLinksRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			workoutId: {
				type: "string",
				label: "Workout Id",
				validation: { required: true },
				description: "Workout Id for this selection",
			},
		},
	});
	const link = table("relationship", "editorSourceLink");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ links }) => Result.succeed(links),
		queries: {
			links: selectedRows(link, {
				limit: WORKOUT_EDITOR_PAGE_SIZE,
				orderBy: [ascending(column(link, "id"))],
				selection: {
					id: selectedField(column(link, "id"), Schema.String),
					targetEntityId: selectedField(column(link, "targetEntityId"), EntityId),
					slug: selectedField(column(link, "relationshipSchemaSlug"), Schema.String),
				},
				where: and(
					schemaOwnerPredicate(link, "relationshipSchemaPluginId", input.reference),
					eq(column(link, "sourceEntityId"), inputParameters.value("workoutId")),
					inArray(column(link, "relationshipSchemaSlug"), [
						literal("workout-repeated-from"),
						literal("workout-to-workout-template"),
					]),
				),
			}),
		},
	});
};
const editableSetFields: ReadonlySet<string> = new Set(workoutSetEditableFields);
export const workoutEditableSetProperties = (properties: WorkoutEditorEvent["properties"]) =>
	Object.fromEntries(Object.entries(properties).filter(([key]) => editableSetFields.has(key)));

export const encodeWorkoutEditorBaseline = (baseline: WorkoutEditorBaseline) => {
	return encodeWorkoutEditorJson(
		JSON.stringify({
			...baseline,
			sets: baseline.sets.map((set) => ({
				...set,
				properties: workoutEditableSetProperties(set.properties),
			})),
		}),
	);
};

export const decodeWorkoutEditorBaseline = (value: unknown) => {
	const decoded = decodeWorkoutEditorJson(value);
	if (decoded._tag === "Failure") {
		return decoded;
	}
	return Schema.decodeResult(Schema.fromJsonString(WorkoutEditorBaselineSchema))(decoded.success);
};

export type WorkoutEditorExercise = Recipe.Success<
	ReturnType<typeof workoutEditorExercisesRecipe>
>["items"][number];
