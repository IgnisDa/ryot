import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import {
	builtinSavedViewReference,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import type { IncludeResult, RowItem } from "@ryot-app/contract/modules/ryotql/language";
import {
	workoutDetailRecipe,
	workoutTemplateDetailRecipe,
	workoutTemplateListRecipe,
} from "@ryot-app/fitness-plugin/query-recipes";
import { PLUGIN_PACKAGE_ID } from "@ryot-app/fitness-plugin/shared/plugin-identity";
import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	createEntity,
	getEntity,
	insertRelationshipRow,
	listSavedViews,
	requireRyotQLValue,
	uploadPermanentAsset,
} from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	createWorkoutTemplateEntityFixture,
	findFitnessEntitySchema,
	findFitnessRelationshipSchema,
	fitnessRecipes,
} from "~/fixtures/plugins/fitness";
import { assertCondition, assertPresent, requirePresent } from "~/support/assertions";
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
			restTime?: number;
			rpe?: null | number;
			reps?: null | number;
			weight?: null | number;
			distance?: null | number;
			duration?: null | number;
			setLot: "drop" | "normal" | "warm_up" | "failure";
		}>;
	}>;
};

const requireRyotQLInclude = (item: RowItem, key: string): IncludeResult => {
	const value = item[key];
	if (!isIncludeResult(value)) {
		throw new Error(`Expected '${key}' include`);
	}
	return value;
};

const isIncludeResult = (value: unknown): value is IncludeResult => {
	if (
		typeof value !== "object" ||
		value === null ||
		!("items" in value) ||
		!("pageInfo" in value) ||
		!Array.isArray(value.items)
	) {
		return false;
	}
	const pageInfo = value.pageInfo;
	return (
		typeof pageInfo === "object" &&
		pageInfo !== null &&
		"limit" in pageInfo &&
		"hasMore" in pageInfo &&
		typeof pageInfo.limit === "number" &&
		typeof pageInfo.hasMore === "boolean" &&
		value.items.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))
	);
};

describe("Workout Templates E2E", () => {
	it.live("links the built-in workout-template schema to the fitness plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId, schema: workoutTemplateSchema } = yield* findFitnessEntitySchema(
				client,
				"workout-template",
			);

			expect(workoutTemplateSchema.name).toEqual({
				namespace: pluginId,
				key: "entity-schema.workout-template.name",
			});
			expect(workoutTemplateSchema.pluginId).toBe(pluginId);
			expect(workoutTemplateSchema.isBuiltin).toBe(true);
		}),
	);

	it.live("exposes the workout-template schema properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId, schema: workoutTemplateSchema } = yield* findFitnessEntitySchema(
				client,
				"workout-template",
			);

			expect(workoutTemplateSchema.propertiesSchema.fields).toMatchObject({
				images: {
					type: "array",
					label: { key: "definition.property.images" },
					description: "Images attached to this template",
				},
				videos: {
					type: "array",
					label: { key: "definition.property.videos" },
					description: "Videos attached to this template",
				},
				comment: {
					type: "string",
					label: { namespace: pluginId, key: "property.comment" },
					description: "Optional notes about this workout template",
				},
				supersets: {
					type: "array",
					description: "Supersets in this template",
					label: { namespace: pluginId, key: "property.supersets" },
					items: {
						type: "object",
						description: "Superset grouping within a workout or template",
						properties: {
							color: {
								type: "string",
								description: "Display color for this superset",
								label: { namespace: pluginId, key: "property.color" },
							},
							exercises: {
								type: "array",
								label: { namespace: pluginId, key: "property.exercises" },
								description: "Zero-based exercise positions in this superset",
							},
						},
					},
				},
				exercises: {
					type: "array",
					description: "Exercises in this template",
					label: { namespace: pluginId, key: "property.exercises" },
					items: {
						type: "object",
						description: "Exercise in this template",
						properties: {
							exerciseId: {
								type: "string",
								description: "Entity id of the exercise",
								label: { namespace: pluginId, key: "property.exercise-id" },
							},
							images: {
								type: "array",
								label: { key: "definition.property.images" },
								description: "Images attached to this exercise in the template",
							},
							videos: {
								type: "array",
								label: { key: "definition.property.videos" },
								description: "Videos attached to this exercise in the template",
							},
							exerciseOrder: {
								type: "integer",
								label: { namespace: pluginId, key: "property.exercise-order" },
								description: "Zero-based position of this exercise within the template",
							},
							sets: {
								type: "array",
								description: "Sets planned for this exercise",
								label: { namespace: pluginId, key: "property.sets" },
								items: {
									type: "object",
									description: "Set planned in this exercise",
									properties: {
										setOrder: {
											type: "integer",
											label: { namespace: pluginId, key: "property.set-order" },
											description: "Zero-based position of this set within the exercise",
										},
										setLot: {
											type: "enum",
											label: { namespace: pluginId, key: "property.set-lot" },
											description: "Set type: normal, warm_up, drop, or failure",
											choices: {
												kind: "static",
												values: [
													{ value: "normal" },
													{ value: "warm_up" },
													{ value: "drop" },
													{ value: "failure" },
												],
											},
										},
									},
								},
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
				const { pluginId } = yield* findFitnessEntitySchema(client, "workout-template");
				const views = yield* listSavedViews(client, { pluginId });
				const allWorkoutTemplatesView = views.find((view) => view.slug === "all-workout-templates");
				assertPresent(
					allWorkoutTemplatesView,
					"Expected the built-in All Workout Templates saved view",
				);
				const dataSources = requirePresent(
					allWorkoutTemplatesView.dataSources,
					"All Workout Templates saved view has no data sources",
				);
				const savedViewSource = dataSources.queries.savedView;
				assertPresent(savedViewSource, "Expected the All Workout Templates named source");
				assertCondition(
					savedViewSource.output.type === "rows",
					"Expected the All Workout Templates named source to use rows output",
				);

				expect(allWorkoutTemplatesView).toMatchObject({
					isBuiltin: true,
					renderer: { kind: "kernel", name: "entity-browser" },
					reference: builtinSavedViewReference(pluginId, "all-workout-templates"),
					name: { namespace: pluginId, key: "saved-view.all-workout-templates.name" },
					settings: {
						defaultLayout: "grid",
						sourceName: "savedView",
						controls: { search: "search" },
						layouts: ["grid", "list", "table"],
						summary: { image: null, subtitle: null },
						subject: {
							entityAlias: "entity",
							schemas: [{ slug: "workout-template", owner: definitionOwner(pluginId) }],
						},
						addAction: {
							search: {},
							type: "plugin-route",
							path: "/templates/new",
							packageId: PLUGIN_PACKAGE_ID,
						},
						tableColumns: [
							{
								field: "name",
								displayKind: "text",
								label: { namespace: pluginId, key: "table-column.name" },
							},
							{
								field: "createdAt",
								displayKind: "date",
								label: { namespace: pluginId, key: "table-column.created-at" },
							},
							{
								field: "comment",
								displayKind: "text",
								label: { namespace: pluginId, key: "property.comment" },
							},
						],
					},
				});
				expect(savedViewSource.output.fields).toEqual<unknown>(
					arrayContaining([
						objectContaining({
							key: "entityId",
							expr: { field: "id", type: "column", tableAlias: "entity" },
						}),
						objectContaining({
							key: "ownerPluginId",
							expr: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
						}),
						objectContaining({
							key: "entitySchemaSlug",
							expr: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
						}),
					]),
				);
				expect(savedViewSource).toEqual<unknown>(
					objectContaining({
						output: objectContaining({
							orderBy: {
								type: "sort",
								otherwise: [
									{
										direction: "desc",
										expr: { type: "column", field: "createdAt", tableAlias: "entity" },
									},
								],
							},
						}),
						where: objectContaining({
							type: "and",
							predicates: arrayContaining([
								objectContaining({
									type: "and",
									predicates: arrayContaining([
										objectContaining({
											type: "and",
											predicates: arrayContaining([
												objectContaining({
													type: "and",
													predicates: arrayContaining([
														objectContaining({
															right: { type: "literal", value: "workout-template" },
															left: {
																type: "column",
																tableAlias: "entity",
																field: "entitySchemaSlug",
															},
														}),
														objectContaining({
															right: { type: "pluginId", reference: { pluginId, kind: "local" } },
															left: {
																type: "column",
																tableAlias: "entity",
																field: "entitySchemaPluginId",
															},
														}),
													]),
												}),
											]),
										}),
									]),
								}),
							]),
						}),
					}),
				);
				expect(
					savedViewSource.output.fields.map((selection) => "key" in selection && selection.key),
				).toEqual([
					"entityId",
					"name",
					"createdAt",
					"comment",
					"ownerPluginId",
					"entitySchemaSlug",
					"__entityBrowserId",
					"__entityBrowserName",
					"__entityBrowserOwnerPluginId",
					"__entityBrowserSchemaSlug",
					"__entityBrowserPopulationStatus",
					"__entityBrowserTranslationStatus",
				]);

				const { workoutTemplate, workoutTemplateId } =
					yield* createWorkoutTemplateEntityFixture(client);
				const result = yield* fitnessRecipes.execute(
					client,
					workoutTemplateListRecipe({ reference: { pluginId, kind: "local" } }),
					{ entityId: workoutTemplateId },
				);

				const firstTemplate = result.items[0];
				assertPresent(firstTemplate, "Expected at least one workout template item");
				expect(result.items).toHaveLength(1);
				expect(firstTemplate.name).toBe(workoutTemplate.name);
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
			const { schema: workoutTemplateSchema } = yield* findFitnessEntitySchema(
				client,
				"workout-template",
			);
			const { exerciseId: firstExerciseId } = yield* createExerciseEntityFixture(client, {
				kind: "reps_and_weight",
				name: "Primary Template Exercise",
			});
			const { exerciseId: secondExerciseId } = yield* createExerciseEntityFixture(client, {
				kind: "reps_and_weight",
				name: "Secondary Template Exercise",
			});
			const video = yield* uploadPermanentAsset(client, {
				fileName: "template.mp4",
				contentType: "video/mp4",
			});
			const workoutTemplateProperties = {
				videos: [video],
				images: [{ type: "remote", url: "https://example.com/template.jpg" }],
				supersets: [
					{ color: "#84CC16", exercises: [0, 1] },
					{ exercises: [1], color: "#22C55E" },
				],
				exercises: [
					{
						notes: [],
						videos: [video],
						exerciseOrder: 0,
						exerciseId: firstExerciseId,
						images: [{ type: "remote", url: "https://example.com/template-image.jpg" }],
						sets: [
							{ setOrder: 0, restTime: 60, setLot: "normal" },
							{ setOrder: 1, restTime: 0, note: "Ramp up", setLot: "warm_up" },
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
				entitySchema: workoutTemplateSchema.reference,
				name: `Workout Template ${yield* randomUuid}`,
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
			const { schema: workoutSchema } = yield* findFitnessEntitySchema(client, "workout");
			const { pluginId } = yield* findFitnessEntitySchema(client, "workout");
			const { workoutTemplate, workoutTemplateId } =
				yield* createWorkoutTemplateEntityFixture(client);
			const workoutName = `Workout ${yield* randomUuid}`;
			const { id: workoutId } = yield* createEntity(client, {
				name: workoutName,
				entitySchema: workoutSchema.reference,
				properties: {
					comment: "Leg day",
					caloriesBurnt: 420,
					endedAt: "2026-04-27T11:00:00Z",
					startedAt: "2026-04-27T10:00:00Z",
				},
			});
			const relationshipSchema = yield* findFitnessRelationshipSchema(
				client,
				"workout-to-workout-template",
			);

			yield* insertRelationshipRow(client, {
				sourceEntityId: workoutId,
				targetEntityId: workoutTemplateId,
				relationshipSchema: relationshipSchema.reference,
			});

			const result = yield* fitnessRecipes.execute(
				client,
				workoutDetailRecipe({ reference: { pluginId, kind: "local" } }),
				{ entityId: workoutId },
			);
			const workoutRow = requirePresent(result, "Expected workout row");
			const template = requireRyotQLInclude(workoutRow, "template").items[0];
			assertPresent(template, "Expected workout template include");
			expect(requireRyotQLValue(template, "id")).toBe(workoutTemplateId);
			expect(requireRyotQLValue(template, "name")).toBe(workoutTemplate.name);
		}),
	);

	it.live("joins a workout from the template side through the seeded relationship schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: workoutSchema } = yield* findFitnessEntitySchema(client, "workout");
			const { pluginId } = yield* findFitnessEntitySchema(client, "workout-template");
			const { workoutTemplateId } = yield* createWorkoutTemplateEntityFixture(client);
			const workoutName = `Workout ${yield* randomUuid}`;
			const { id: workoutId } = yield* createEntity(client, {
				name: workoutName,
				entitySchema: workoutSchema.reference,
				properties: {
					comment: "Leg day",
					caloriesBurnt: 420,
					endedAt: "2026-04-27T11:00:00Z",
					startedAt: "2026-04-27T10:00:00Z",
				},
			});
			const relationshipSchema = yield* findFitnessRelationshipSchema(
				client,
				"workout-to-workout-template",
			);

			yield* insertRelationshipRow(client, {
				sourceEntityId: workoutId,
				targetEntityId: workoutTemplateId,
				relationshipSchema: relationshipSchema.reference,
			});

			const result = yield* fitnessRecipes.execute(
				client,
				workoutTemplateDetailRecipe({ reference: { pluginId, kind: "local" } }),
				{ entityId: workoutTemplateId },
			);
			const templateRow = requirePresent(result, "Expected workout template row");
			const workout = requireRyotQLInclude(templateRow, "workouts").items[0];
			assertPresent(workout, "Expected workout include");
			expect(requireRyotQLValue(workout, "id")).toBe(workoutId);
			expect(requireRyotQLValue(workout, "name")).toBe(workoutName);
		}),
	);
});
