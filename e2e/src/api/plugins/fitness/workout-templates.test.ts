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
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	createEntity,
	executeRyotQLRecipe,
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
			restTime?: number;
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

			expect(workoutTemplateSchema.name).toBe("Workout Template");
			expect(workoutTemplateSchema.pluginId).toBe(pluginId);
			expect(workoutTemplateSchema.isBuiltin).toBe(true);
		}),
	);

	it.live("exposes the workout-template schema properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: workoutTemplateSchema } = yield* findFitnessEntitySchema(
				client,
				"workout-template",
			);

			expect(workoutTemplateSchema.propertiesSchema.fields).toMatchObject({
				images: { type: "array", label: "Images", description: "Images attached to this template" },
				videos: { type: "array", label: "Videos", description: "Videos attached to this template" },
				comment: {
					type: "string",
					label: "Comment",
					description: "Optional notes about this workout template",
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
				const allWorkoutTemplatesView = views.find((view) => view.name === "All Workout Templates");
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
					name: "All Workout Templates",
					renderer: { kind: "kernel", name: "entity-browser" },
					reference: builtinSavedViewReference(pluginId, "all-workout-templates"),
					settings: {
						defaultLayout: "grid",
						searchFields: ["name"],
						sourceName: "savedView",
						layouts: ["grid", "list", "table"],
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
							{ label: "Name", field: "name", displayKind: "text" },
							{ field: "createdAt", label: "Created At", displayKind: "date" },
							{ label: "Comment", field: "comment", displayKind: "text" },
						],
					},
				});
				expect(savedViewSource.output.fields).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							key: "entityId",
							expr: { field: "id", type: "column", tableAlias: "entity" },
						}),
						expect.objectContaining({
							key: "ownerPluginId",
							expr: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
						}),
						expect.objectContaining({
							key: "entitySchemaSlug",
							expr: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
						}),
					]),
				);
				expect(savedViewSource).toMatchObject({
					output: {
						orderBy: [{ direction: "desc", expr: { type: "column", field: "createdAt" } }],
					},
					where: {
						type: "and",
						predicates: expect.arrayContaining([
							expect.objectContaining({
								type: "and",
								predicates: expect.arrayContaining([
									expect.objectContaining({
										right: { type: "literal", value: "workout-template" },
										left: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
									}),
									expect.objectContaining({
										right: { type: "pluginId", reference: { pluginId, kind: "local" } },
										left: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
									}),
								]),
							}),
						]),
					},
				});
				expect(
					savedViewSource.output.fields.map((selection) => "key" in selection && selection.key),
				).toEqual([
					"entityId",
					"name",
					"createdAt",
					"comment",
					"ownerPluginId",
					"entitySchemaSlug",
					"presentationId",
					"presentationName",
					"presentationPrimary",
					"presentationCallout",
					"presentationSecondary",
					"presentationImage",
					"presentationLatestValue",
					"presentationLatestAt",
				]);

				const { workoutTemplate, workoutTemplateId } =
					yield* createWorkoutTemplateEntityFixture(client);
				const result = yield* executeRyotQLRecipe(
					client,
					workoutTemplateListRecipe({
						entityId: workoutTemplateId,
						reference: { pluginId, kind: "local" },
					}),
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
			const { schema: workoutSchema } = yield* findFitnessEntitySchema(client, "workout");
			const { pluginId } = yield* findFitnessEntitySchema(client, "workout");
			const { workoutTemplate, workoutTemplateId } =
				yield* createWorkoutTemplateEntityFixture(client);
			const workoutName = `Workout ${crypto.randomUUID()}`;
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

			const result = yield* executeRyotQLRecipe(
				client,
				workoutDetailRecipe({
					templateLimit: 1,
					entityId: workoutId,
					reference: { pluginId, kind: "local" },
				}),
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
			const workoutName = `Workout ${crypto.randomUUID()}`;
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

			const result = yield* executeRyotQLRecipe(
				client,
				workoutTemplateDetailRecipe({
					workoutLimit: 10,
					entityId: workoutTemplateId,
					reference: { pluginId, kind: "local" },
				}),
			);
			const templateRow = requirePresent(result, "Expected workout template row");
			const workout = requireRyotQLInclude(templateRow, "workouts").items[0];
			assertPresent(workout, "Expected workout include");
			expect(requireRyotQLValue(workout, "id")).toBe(workoutId);
			expect(requireRyotQLValue(workout, "name")).toBe(workoutName);
		}),
	);
});
