import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
} from "@ryot/contract/display-configuration";
import type { IncludeResult, RowItem } from "@ryot/contract/modules/ryotql/language";
import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import {
	buildWorkoutDetailQueryDocument,
	buildWorkoutTemplateDetailQueryDocument,
	buildWorkoutTemplateListQueryDocument,
} from "@ryot/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createCollection,
	createWorkoutTemplateEntityFixture,
	executeRyotQL,
	findBuiltinRelationshipSchemaSlug,
	findBuiltinSchemaBySlug,
	findBuiltinPluginBySlug,
	getEntity,
	insertRelationshipRow,
	listEntitySchemas,
	listSavedViews,
	waitForSeededExerciseIds,
	requireRyotQLFieldValue,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

type WorkoutTemplateProperties = {
	comment?: string;
	images?: AssetLocator[];
	videos?: AssetLocator[];
	supersets?: Array<{ color: string; exercises: number[] }>;
	exercises: Array<{
		notes?: string[];
		exerciseId: string;
		exerciseOrder: number;
		images?: AssetLocator[];
		videos?: AssetLocator[];
		sets: Array<{
			note?: string;
			setOrder: number;
			rpe?: number | null;
			reps?: number | null;
			weight?: number | null;
			distance?: number | null;
			duration?: number | null;
			setLot: "normal" | "warm_up" | "drop" | "failure";
		}>;
	}>;
};

const requireRyotQLInclude = (item: RowItem, key: string): IncludeResult => {
	const value = item[key];
	if (!value || !("items" in value)) {
		throw new Error(`Expected '${key}' include`);
	}
	return value;
};

describe("Workout Templates E2E", () => {
	it.live("links the built-in workout-template schema to the fitness plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fitnessPlugin = yield* findBuiltinPluginBySlug(client, "fitness");
			const schemas = yield* listEntitySchemas(client, {
				pluginSlug: fitnessPlugin.slug,
			});
			const workoutTemplateSchema = schemas.find((schema) => schema.slug === "workout-template");

			expect(workoutTemplateSchema).toBeDefined();
			expect(workoutTemplateSchema?.name).toBe("Workout Template");
			expect(workoutTemplateSchema?.pluginSlug).toBe(fitnessPlugin.slug);
			expect(workoutTemplateSchema?.isBuiltin).toBe(true);
		}),
	);

	it.live("exposes the workout-template schema properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: workoutTemplateSchema } = yield* findBuiltinSchemaBySlug(
				client,
				"workout-template",
			);

			expect(workoutTemplateSchema.propertiesSchema.fields).toMatchObject({
				comment: {
					type: "string",
					label: "Comment",
					description: "Optional notes about this workout template",
				},
				images: {
					type: "array",
					label: "Images",
					description: "Images attached to this template",
				},
				videos: {
					type: "array",
					label: "Videos",
					description: "Videos attached to this template",
				},
				exercises: {
					type: "array",
					label: "Exercises",
					description: "Exercises in this template",
					items: {
						type: "object",
						description: "Exercise in this template",
						properties: {
							exerciseId: {
								type: "string",
								label: "Exercise Id",
								description: "Entity id of the exercise",
							},
							images: {
								type: "array",
								label: "Images",
								description: "Images attached to this exercise in the template",
							},
							videos: {
								type: "array",
								label: "Videos",
								description: "Videos attached to this exercise in the template",
							},
							exerciseOrder: {
								type: "integer",
								label: "Exercise Order",
								description: "Zero-based position of this exercise within the template",
							},
							sets: {
								label: "Sets",
								type: "array",
								description: "Sets planned for this exercise",
								items: {
									type: "object",
									description: "Set planned in this exercise",
									properties: {
										setOrder: {
											type: "integer",
											label: "Set Order",
											description: "Zero-based position of this set within the exercise",
										},
										setLot: {
											type: "enum",
											label: "Set Lot",
											options: ["normal", "warm_up", "drop", "failure"],
											description: "Set type: normal, warm_up, drop, or failure",
										},
									},
								},
							},
						},
					},
				},
				supersets: {
					type: "array",
					label: "Supersets",
					description: "Supersets in this template",
					items: {
						type: "object",
						description: "Superset grouping within a workout or template",
						properties: {
							color: {
								label: "Color",
								type: "string",
								description: "Display color for this superset",
							},
							exercises: {
								type: "array",
								label: "Exercises",
								description: "Zero-based exercise positions in this superset",
							},
						},
					},
				},
			});
		}),
	);

	it.live(
		"creates the built-in All Workout Templates saved view with workout-template defaults",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const fitnessPlugin = yield* findBuiltinPluginBySlug(client, "fitness");
				const views = yield* listSavedViews(client, {
					pluginSlug: fitnessPlugin.slug,
				});
				const allWorkoutTemplatesView = views.find((view) => view.name === "All Workout Templates");

				expect(allWorkoutTemplatesView).toBeDefined();
				expect(allWorkoutTemplatesView).toMatchObject({
					isBuiltin: true,
					pluginSlug: fitnessPlugin.slug,
					name: "All Workout Templates",
					queryDocument: {
						queries: {
							savedView: {
								output: {
									orderBy: [{ direction: "desc", expr: { type: "column", field: "createdAt" } }],
								},
								where: {
									right: { value: "workout-template" },
									left: { field: "entitySchemaSlug", tableAlias: "entity" },
								},
							},
						},
					},
					displayConfiguration: {
						grid: {
							imageProperty: null,
							calloutProperty: null,
							titleProperty: createEntityColumnExpression("workout-template", "name"),
							primarySubtitleProperty: createEntityColumnExpression(
								"workout-template",
								"createdAt",
							),
							secondarySubtitleProperty: createEntityPropertyExpression(
								"workout-template",
								"comment",
							),
						},
						table: {
							columns: [
								{
									label: "Name",
									expression: createEntityColumnExpression("workout-template", "name"),
								},
								{
									label: "Created At",
									expression: createEntityColumnExpression("workout-template", "createdAt"),
								},
								{
									label: "Comment",
									expression: createEntityPropertyExpression("workout-template", "comment"),
								},
							],
						},
					},
				});

				const { workoutTemplate, workoutTemplateId } =
					yield* createWorkoutTemplateEntityFixture(client);
				const result = yield* executeRyotQL(
					client,
					buildWorkoutTemplateListQueryDocument({ entityId: workoutTemplateId }),
				);
				const templates = result.data["workoutTemplates"];
				if (templates?.type !== "rows") {
					throw new Error("Expected workout templates rows result");
				}

				const firstTemplate = templates.items[0];
				assertPresent(firstTemplate, "Expected at least one workout template item");
				expect(templates.items).toHaveLength(1);
				expect(requireRyotQLFieldValue(firstTemplate, "name").value).toBe(workoutTemplate.name);
			}),
	);

	it.live("creates a workout-template entity and retrieves it by id", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { workoutTemplate, workoutTemplateId } =
				yield* createWorkoutTemplateEntityFixture(client);
			const entity = yield* getEntity(client, workoutTemplateId);

			expect(entity.id).toBe(workoutTemplateId);
			expect(entity.name).toBe(workoutTemplate.name);
			expect(entity.properties).toMatchObject(workoutTemplate.properties);
		}),
	);

	it.live("persists omitted optional fields and multiple nested exercises", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: workoutTemplateSchema } = yield* findBuiltinSchemaBySlug(
				client,
				"workout-template",
			);
			const exerciseIds = yield* waitForSeededExerciseIds(client, 2);
			const firstExerciseId = exerciseIds[0];
			const secondExerciseId = exerciseIds[1];
			assertPresent(firstExerciseId, "Missing seeded exercise ids for workout template fixture");
			assertPresent(secondExerciseId, "Missing seeded exercise ids for workout template fixture");
			const workoutTemplateProperties = {
				images: [{ type: "remote", url: "https://example.com/template.jpg" }],
				videos: [{ type: "s3", key: "templates/video.mp4" }],
				supersets: [
					{ color: "#84CC16", exercises: [0, 1] },
					{ color: "#22C55E", exercises: [1] },
				],
				exercises: [
					{
						notes: [],
						exerciseOrder: 0,
						exerciseId: firstExerciseId,
						images: [{ type: "remote", url: "https://example.com/template-image.jpg" }],
						videos: [{ type: "s3", key: "templates/video.mp4" }],
						sets: [
							{ setOrder: 0, setLot: "normal" },
							{ setOrder: 1, note: "Ramp up", setLot: "warm_up" },
						],
					},
					{
						exerciseOrder: 1,
						exerciseId: secondExerciseId,
						notes: ["Secondary movement"],
						sets: [
							{
								rpe: 8,
								reps: 8,
								weight: 40,
								setOrder: 0,
								setLot: "drop",
								distance: null,
								duration: null,
							},
						],
					},
				],
			} satisfies WorkoutTemplateProperties;

			const workoutTemplate = yield* createEntity(client, {
				properties: workoutTemplateProperties,
				entitySchemaSlug: workoutTemplateSchema.id,
				name: `Workout Template ${crypto.randomUUID()}`,
			});

			const entity = yield* getEntity(client, workoutTemplate.id);

			expect(entity.properties).toMatchObject(workoutTemplateProperties);
			expect(entity.properties).not.toHaveProperty("comment");
			expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.note");
			expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.reps");
			expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.weight");
			expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.duration");
			expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.distance");
			expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.rpe");
		}),
	);

	it.live("allows workout templates to be added to a collection", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client, {
				name: "Workout Templates",
				description: "Templates for the training plan",
			});
			const { workoutTemplateId } = yield* createWorkoutTemplateEntityFixture(client);

			const data = yield* client.call((c) =>
				c.collections.createMembership({
					payload: { entityId: workoutTemplateId, collectionId: collection.id },
				}),
			);

			expect(data.memberOf.sourceEntityId).toBe(workoutTemplateId);
			expect(data.memberOf.targetEntityId).toBe(collection.id);
		}),
	);

	it.live("joins a workout to its template through the seeded relationship schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: workoutSchema } = yield* findBuiltinSchemaBySlug(client, "workout");
			const { workoutTemplateId, workoutTemplate } =
				yield* createWorkoutTemplateEntityFixture(client);
			const workoutName = `Workout ${crypto.randomUUID()}`;
			const { id: workoutId } = yield* createEntity(client, {
				name: workoutName,
				entitySchemaSlug: workoutSchema.id,
				properties: {
					comment: "Leg day",
					caloriesBurnt: 420,
					endedAt: "2026-04-27T11:00:00Z",
					startedAt: "2026-04-27T10:00:00Z",
				},
			});
			const relationshipSchemaSlug = yield* findBuiltinRelationshipSchemaSlug(
				client,
				"workout-to-workout-template",
			);

			yield* insertRelationshipRow(client, {
				relationshipSchemaSlug,
				sourceEntityId: workoutId,
				targetEntityId: workoutTemplateId,
			});

			const result = yield* executeRyotQL(
				client,
				buildWorkoutDetailQueryDocument({ entityId: workoutId, templateLimit: 1 }),
			);
			const workouts = result.data["workout"];
			if (workouts?.type !== "rows") {
				throw new Error("Expected workout rows result");
			}
			expect(workouts.items).toHaveLength(1);
			const workoutRow = workouts.items[0];
			assertPresent(workoutRow, "Expected workout row");
			const template = requireRyotQLInclude(workoutRow, "template").items[0];
			assertPresent(template, "Expected workout template include");
			expect(requireRyotQLFieldValue(template, "id")).toEqual({
				kind: "text",
				value: workoutTemplateId,
			});
			expect(requireRyotQLFieldValue(template, "name")).toEqual({
				kind: "text",
				value: workoutTemplate.name,
			});
		}),
	);

	it.live("joins a workout from the template side through the seeded relationship schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: workoutSchema } = yield* findBuiltinSchemaBySlug(client, "workout");
			const { workoutTemplateId } = yield* createWorkoutTemplateEntityFixture(client);
			const workoutName = `Workout ${crypto.randomUUID()}`;
			const { id: workoutId } = yield* createEntity(client, {
				name: workoutName,
				entitySchemaSlug: workoutSchema.id,
				properties: {
					comment: "Leg day",
					caloriesBurnt: 420,
					endedAt: "2026-04-27T11:00:00Z",
					startedAt: "2026-04-27T10:00:00Z",
				},
			});
			const relationshipSchemaSlug = yield* findBuiltinRelationshipSchemaSlug(
				client,
				"workout-to-workout-template",
			);

			yield* insertRelationshipRow(client, {
				relationshipSchemaSlug,
				sourceEntityId: workoutId,
				targetEntityId: workoutTemplateId,
			});

			const result = yield* executeRyotQL(
				client,
				buildWorkoutTemplateDetailQueryDocument({ entityId: workoutTemplateId, workoutLimit: 10 }),
			);
			const templates = result.data["workoutTemplate"];
			if (templates?.type !== "rows") {
				throw new Error("Expected workout template rows result");
			}
			expect(templates.items).toHaveLength(1);
			const templateRow = templates.items[0];
			assertPresent(templateRow, "Expected workout template row");
			const workout = requireRyotQLInclude(templateRow, "workouts").items[0];
			assertPresent(workout, "Expected workout include");
			expect(requireRyotQLFieldValue(workout, "id")).toEqual({
				kind: "text",
				value: workoutId,
			});
			expect(requireRyotQLFieldValue(workout, "name")).toEqual({
				kind: "text",
				value: workoutName,
			});
		}),
	);
});
