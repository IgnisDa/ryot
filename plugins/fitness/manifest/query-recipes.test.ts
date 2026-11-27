import { describe, expect, it } from "bun:test";

import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";
import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";

import {
	exerciseListRecipe,
	workoutDetailRecipe,
	workoutTemplateDetailRecipe,
} from "../shared/query-recipes";
import {
	equipmentListRecipe,
	exerciseEquipmentRecipe,
	exerciseTargetsRecipe,
	targetListRecipe,
} from "../shared/taxonomy-recipes";

describe("fitness query recipes", () => {
	it("builds typed filtered exercise rows", () => {
		const recipe = bindRecipe(exerciseListRecipe({ reference: { kind: "self" } }), {
			limit: 5,
			name: "Push Up",
			entityId: "exercise-id",
			after: "exercise-cursor",
		});
		const exercises = recipe.document.queries["exercises"];
		if (exercises?.output.type !== "rows") {
			throw new Error("Expected exercise rows query");
		}

		expect(exercises.where).toEqual<unknown>(
			objectContaining({
				predicates: arrayContaining([
					objectContaining({
						predicates: [
							objectContaining({
								operator: "eq",
								right: { type: "literal", value: "exercise" },
								left: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
							}),
							objectContaining({
								right: { type: "pluginId", reference: { kind: "self" } },
								left: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
							}),
						],
					}),
					objectContaining({
						operator: "eq",
						right: { type: "literal", value: "exercise-id" },
						left: { field: "id", type: "column", tableAlias: "entity" },
					}),
					objectContaining({
						operator: "eq",
						right: { type: "literal", value: "Push Up" },
						left: { field: "name", type: "column", tableAlias: "entity" },
					}),
				]),
			}),
		);
		expect(
			bindRecipe(exerciseListRecipe({ reference: { kind: "self" } }), {}).document.queries.exercises
				?.where,
		).toEqual({
			type: "and",
			predicates: [
				{
					type: "and",
					predicates: [
						{
							operator: "eq",
							type: "comparison",
							right: { type: "literal", value: "exercise" },
							left: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
						},
						{
							operator: "eq",
							type: "comparison",
							right: { type: "pluginId", reference: { kind: "self" } },
							left: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
						},
					],
				},
				{ type: "and", predicates: [] },
				{ type: "and", predicates: [] },
			],
		});
		expect(exercises.output).toEqual<unknown>(
			objectContaining({
				orderBy: [objectContaining({ direction: "asc" })],
				pagination: { limit: 5, after: "exercise-cursor" },
				include: [
					objectContaining({
						limit: 100,
						key: "equipment",
						from: { table: "relationship", alias: "exerciseEquipmentRelationship" },
						joins: [objectContaining({ table: { table: "entity", alias: "exerciseEquipment" } })],
					}),
				],
				fields: arrayContaining([
					objectContaining({
						key: "image",
						expr: objectContaining({ type: "jsonPath", path: ["images", 0] }),
					}),
					objectContaining({
						key: "level",
						expr: objectContaining({ type: "cast", target: "text" }),
					}),
				]),
			}),
		);
		expect(exercises.output.fields).not.toEqual(
			arrayContaining([objectContaining({ key: "equipment" })]),
		);
	});

	it("uses the plural workouts include for template detail", () => {
		const recipe = bindRecipe(workoutTemplateDetailRecipe({ reference: { kind: "self" } }), {
			entityId: "template-id",
		});
		const workoutTemplate = recipe.document.queries["workoutTemplate"];
		if (workoutTemplate?.output.type !== "rows") {
			throw new Error("Expected workout template rows query");
		}

		expect(workoutTemplate.output).toMatchObject({
			include: [
				{
					limit: 100,
					key: "workouts",
					from: { table: "relationship", alias: "workoutRelationship" },
				},
			],
		});
	});

	it("uses explicit relationship directions for workout details", () => {
		const workoutRecipe = bindRecipe(workoutDetailRecipe({ reference: { kind: "self" } }), {
			entityId: "workout-id",
		});
		const templateRecipe = bindRecipe(
			workoutTemplateDetailRecipe({ reference: { kind: "self" } }),
			{ entityId: "template-id" },
		);
		const workout = workoutRecipe.document.queries["workout"];
		const workoutTemplate = templateRecipe.document.queries["workoutTemplate"];
		if (workout?.output.type !== "rows" || workoutTemplate?.output.type !== "rows") {
			throw new Error("Expected workout detail rows queries");
		}

		expect(workout.output).toEqual<unknown>(
			objectContaining({
				fields: arrayContaining([
					objectContaining({
						key: "startedAt",
						expr: objectContaining({ type: "cast", target: "date" }),
					}),
					objectContaining({
						key: "caloriesBurnt",
						expr: objectContaining({ type: "cast", target: "number" }),
					}),
				]),
				include: arrayContaining([
					objectContaining({
						limit: 100,
						key: "template",
						from: { table: "relationship", alias: "templateRelationship" },
						joins: arrayContaining([
							objectContaining({
								on: objectContaining({
									right: objectContaining({ field: "id", tableAlias: "template" }),
									left: objectContaining({
										field: "targetEntityId",
										tableAlias: "templateRelationship",
									}),
								}),
							}),
						]),
						where: objectContaining({
							predicates: arrayContaining([
								objectContaining({
									right: objectContaining({ field: "id", tableAlias: "entity" }),
									left: objectContaining({
										field: "sourceEntityId",
										tableAlias: "templateRelationship",
									}),
								}),
							]),
						}),
					}),
				]),
			}),
		);
		expect(workoutTemplate.output).toEqual<unknown>(
			objectContaining({
				include: arrayContaining([
					objectContaining({
						limit: 100,
						key: "workouts",
						from: { table: "relationship", alias: "workoutRelationship" },
						joins: arrayContaining([
							objectContaining({
								on: objectContaining({
									right: objectContaining({ field: "id", tableAlias: "workout" }),
									left: objectContaining({
										field: "sourceEntityId",
										tableAlias: "workoutRelationship",
									}),
								}),
							}),
						]),
						where: objectContaining({
							predicates: arrayContaining([
								objectContaining({
									right: objectContaining({ field: "id", tableAlias: "entity" }),
									left: objectContaining({
										field: "targetEntityId",
										tableAlias: "workoutRelationship",
									}),
								}),
							]),
						}),
					}),
				]),
			}),
		);
	});

	it("queries shared and user-owned taxonomy entities and their exercise relationships", () => {
		const targetList = bindRecipe(targetListRecipe({ reference: { kind: "self" } }), {
			limit: 4,
			name: "Lats",
			after: "target-cursor",
		});
		const targetRows = targetList.document.queries.targets;
		const equipmentList = bindRecipe(equipmentListRecipe({ reference: { kind: "self" } }), {
			limit: 5,
		});
		const equipmentRows = equipmentList.document.queries.equipment;
		const targets = bindRecipe(exerciseTargetsRecipe({ reference: { kind: "self" } }), {
			limit: 3,
			exerciseId: "exercise-1",
			after: "relationship-cursor",
		});
		const targetRelationships = targets.document.queries.targets;
		const equipment = bindRecipe(exerciseEquipmentRecipe({ reference: { kind: "self" } }), {
			limit: 2,
			exerciseId: "exercise-1",
		});
		const equipmentRelationships = equipment.document.queries.equipment;
		if (
			targetRows?.output.type !== "rows" ||
			equipmentRows?.output.type !== "rows" ||
			targetRelationships?.output.type !== "rows" ||
			equipmentRelationships?.output.type !== "rows"
		) {
			throw new Error("Expected taxonomy rows queries");
		}

		expect(targetRows.output).toMatchObject({ pagination: { limit: 4, after: "target-cursor" } });
		expect(targetRows.where).toEqual<unknown>(
			objectContaining({
				predicates: arrayContaining([
					objectContaining({
						predicates: [
							objectContaining({ right: { type: "literal", value: "exercise-target" } }),
							objectContaining({ right: { type: "pluginId", reference: { kind: "self" } } }),
						],
					}),
					objectContaining({ right: { value: "Lats", type: "literal" } }),
				]),
			}),
		);
		expect(targetRows.output.fields.map((field) => "key" in field && field.key)).toEqual([
			"id",
			"name",
			"kind",
			"userId",
		]);
		expect(equipmentRows.where).toEqual<unknown>(
			objectContaining({
				predicates: [
					objectContaining({
						predicates: [
							objectContaining({ right: { type: "literal", value: "exercise-equipment" } }),
							objectContaining({ right: { type: "pluginId", reference: { kind: "self" } } }),
						],
					}),
					{ type: "and", predicates: [] },
				],
			}),
		);
		expect(targetRelationships.output).toEqual<unknown>(
			objectContaining({
				pagination: objectContaining({ limit: 3, after: "relationship-cursor" }),
				orderBy: [objectContaining({ direction: "asc" }), objectContaining({ direction: "asc" })],
				fields: arrayContaining([
					objectContaining({ key: "relationshipId" }),
					objectContaining({ key: "id" }),
					objectContaining({ key: "userId" }),
					objectContaining({ key: "kind" }),
					objectContaining({ key: "role" }),
				]),
			}),
		);
		expect(targetRelationships.where).toEqual<unknown>(
			objectContaining({
				predicates: arrayContaining([
					objectContaining({ right: { type: "literal", value: "exercise-1" } }),
					objectContaining({ right: { type: "literal", value: "exercise-targets" } }),
					objectContaining({ right: { type: "literal", value: "exercise-target" } }),
				]),
			}),
		);
		expect(equipmentRelationships.where).toEqual<unknown>(
			objectContaining({
				predicates: arrayContaining([
					objectContaining({ right: { type: "literal", value: "exercise-uses-equipment" } }),
					objectContaining({ right: { type: "literal", value: "exercise-equipment" } }),
				]),
			}),
		);
	});
});
