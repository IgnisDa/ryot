import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	inArray,
	JsonValue,
	isNotNull,
	literal,
	relationshipSchemaPredicate,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EventId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { decodeWorkoutEditorJson, encodeWorkoutEditorJson } from "./workout-editor-codec";
import { workoutSetEditableFields } from "./workout-set";

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
export type WorkoutEditorBaseline = typeof WorkoutEditorBaselineSchema.Type;
export type WorkoutEditorEvent = typeof WorkoutEditorEventSchema.Type;

export const workoutEditorEntityRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly entityId: string;
		readonly kind: "workout" | "workout-template";
	}) => {
		const entity = table("entity", "editorEntity");
		return {
			map: ({ entity: result }) => Result.succeed(result ?? null),
			queries: {
				entity: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					where: and(
						entitySchemaPredicate(entity, input.kind, input.reference),
						eq(column(entity, "id"), literal(input.entityId)),
					),
					selection: {
						id: selectedField(column(entity, "id"), EntityId),
						name: selectedField(column(entity, "name"), Schema.String),
						updatedAt: selectedField(column(entity, "updatedAt"), Schema.String),
						properties: selectedField(column(entity, "properties"), WorkoutEditorPropertiesSchema),
					},
				}),
			},
		};
	},
);

export const workoutEditorSetsRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly workoutId: string;
		readonly after?: string | undefined;
	}) => {
		const event = table("event", "editorSet");
		return {
			map: ({ sets }) => Result.succeed(sets),
			queries: {
				sets: selectedRows(event, {
					after: input.after,
					limit: WORKOUT_EDITOR_PAGE_SIZE,
					orderBy: [ascending(column(event, "id"))],
					where: and(
						schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
						eq(column(event, "eventSchemaSlug"), literal("workout-set")),
						eq(column(event, "sessionEntityId"), literal(input.workoutId)),
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
		};
	},
);

export const workoutEditorExercisesRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly exerciseIds: readonly string[];
		readonly after?: string | undefined;
	}) => {
		const exercise = table("entity", "editorExercise");
		return {
			map: ({ exercises }) => Result.succeed(exercises),
			queries: {
				exercises: selectedRows(exercise, {
					after: input.after,
					limit: WORKOUT_EDITOR_PAGE_SIZE,
					orderBy: [ascending(column(exercise, "id"))],
					where: and(
						entitySchemaPredicate(exercise, "exercise", input.reference),
						inArray(column(exercise, "id"), input.exerciseIds.map(literal)),
					),
					selection: {
						id: selectedField(column(exercise, "id"), EntityId),
						name: selectedField(column(exercise, "name"), Schema.String),
						properties: selectedField(
							column(exercise, "properties"),
							WorkoutEditorPropertiesSchema,
						),
					},
				}),
			},
		};
	},
);

export const workoutEditorEventIdentitiesRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly eventIds: readonly string[];
	}) => {
		const event = table("event", "editorEventIdentity");
		return {
			map: ({ identities }) => Result.succeed(identities.items),
			queries: {
				identities: selectedRows(event, {
					limit: WORKOUT_EDITOR_PAGE_SIZE,
					orderBy: [ascending(column(event, "id"))],
					where: and(
						schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
						inArray(column(event, "id"), input.eventIds.map(literal)),
					),
					selection: {
						id: selectedField(column(event, "id"), EventId),
						entityId: selectedField(column(event, "entityId"), EntityId),
						slug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
						sessionEntityId: selectedField(
							column(event, "sessionEntityId"),
							Schema.NullOr(EntityId),
						),
					},
				}),
			},
		};
	},
);

export const workoutEditorMembershipRecipe = defineRecipe(
	(input: { readonly reference: PluginIdentityReference; readonly exerciseId: string }) => {
		const link = table("relationship", "editorMembership");
		return {
			map: ({ membership }) => Result.succeed(membership ?? null),
			queries: {
				membership: selectedOptionalRow(link, {
					orderBy: [ascending(column(link, "id"))],
					where: and(
						relationshipSchemaPredicate(link, "in-fitness-library", input.reference),
						isNotNull(column(link, "userId")),
						eq(column(link, "sourceEntityId"), literal(input.exerciseId)),
					),
					selection: {
						id: selectedField(column(link, "id"), Schema.String),
						targetEntityId: selectedField(column(link, "targetEntityId"), EntityId),
						properties: selectedField(column(link, "properties"), WorkoutEditorPropertiesSchema),
					},
				}),
			},
		};
	},
);

export const workoutEditorLinksRecipe = defineRecipe(
	(input: { readonly reference: PluginIdentityReference; readonly workoutId: string }) => {
		const link = table("relationship", "editorSourceLink");
		return {
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
						eq(column(link, "sourceEntityId"), literal(input.workoutId)),
						inArray(column(link, "relationshipSchemaSlug"), [
							literal("workout-repeated-from"),
							literal("workout-to-workout-template"),
						]),
					),
				}),
			},
		};
	},
);

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
	typeof workoutEditorExercisesRecipe
>["items"][number];
