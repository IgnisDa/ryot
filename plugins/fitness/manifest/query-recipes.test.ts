import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";
import { describe, expect, it } from "vitest";

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
		const recipe = exerciseListRecipe({
			limit: 5,
			name: "Push Up",
			entityId: "exercise-id",
			after: "exercise-cursor",
			reference: { kind: "self" },
		});
		const exercises = recipe.document.queries["exercises"];
		if (exercises?.output.type !== "rows") {
			throw new Error("Expected exercise rows query");
		}

		expect(exercises.where).toEqual(
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
			exerciseListRecipe({ reference: { kind: "self" } }).document.queries.exercises?.where,
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
			],
		});
		expect(exercises.output).toEqual(
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
		const recipe = workoutTemplateDetailRecipe({
			workoutLimit: 6,
			entityId: "template-id",
			reference: { kind: "self" },
		});
		const workoutTemplate = recipe.document.queries["workoutTemplate"];
		if (workoutTemplate?.output.type !== "rows") {
			throw new Error("Expected workout template rows query");
		}

		expect(workoutTemplate.output).toMatchObject({
			include: [
				{
					limit: 6,
					key: "workouts",
					from: { table: "relationship", alias: "workoutRelationship" },
				},
			],
		});
	});

	it("uses explicit relationship directions for workout details", () => {
		const workoutRecipe = workoutDetailRecipe({
			templateLimit: 3,
			entityId: "workout-id",
			reference: { kind: "self" },
		});
		const templateRecipe = workoutTemplateDetailRecipe({
			workoutLimit: 4,
			entityId: "template-id",
			reference: { kind: "self" },
		});
		const workout = workoutRecipe.document.queries["workout"];
		const workoutTemplate = templateRecipe.document.queries["workoutTemplate"];
		if (workout?.output.type !== "rows" || workoutTemplate?.output.type !== "rows") {
			throw new Error("Expected workout detail rows queries");
		}

		expect(workout.output).toEqual(
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
						limit: 3,
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
		expect(workoutTemplate.output).toEqual(
			objectContaining({
				include: arrayContaining([
					objectContaining({
						limit: 4,
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
		const targetList = targetListRecipe({
			limit: 4,
			name: "Lats",
			after: "target-cursor",
			reference: { kind: "self" },
		});
		const targetRows = targetList.document.queries.targets;
		const equipmentList = equipmentListRecipe({ limit: 5, reference: { kind: "self" } });
		const equipmentRows = equipmentList.document.queries.equipment;
		const targets = exerciseTargetsRecipe({
			limit: 3,
			exerciseId: "exercise-1",
			reference: { kind: "self" },
			after: "relationship-cursor",
		});
		const targetRelationships = targets.document.queries.targets;
		const equipment = exerciseEquipmentRecipe({
			limit: 2,
			exerciseId: "exercise-1",
			reference: { kind: "self" },
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
		expect(targetRows.where).toEqual(
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
		expect(equipmentRows.where).toMatchObject({
			predicates: [
				objectContaining({
					predicates: [
						objectContaining({ right: { type: "literal", value: "exercise-equipment" } }),
						objectContaining({ right: { type: "pluginId", reference: { kind: "self" } } }),
					],
				}),
			],
		});
		expect(targetRelationships.output).toMatchObject({
			pagination: { limit: 3, after: "relationship-cursor" },
			orderBy: [objectContaining({ direction: "asc" }), objectContaining({ direction: "asc" })],
			fields: arrayContaining([
				objectContaining({ key: "relationshipId" }),
				objectContaining({ key: "id" }),
				objectContaining({ key: "userId" }),
				objectContaining({ key: "kind" }),
				objectContaining({ key: "role" }),
			]),
		});
		expect(targetRelationships.where).toEqual(
			objectContaining({
				predicates: arrayContaining([
					objectContaining({ right: { type: "literal", value: "exercise-1" } }),
					objectContaining({ right: { type: "literal", value: "exercise-targets" } }),
					objectContaining({ right: { type: "literal", value: "exercise-target" } }),
				]),
			}),
		);
		expect(equipmentRelationships.where).toEqual(
			objectContaining({
				predicates: arrayContaining([
					objectContaining({ right: { type: "literal", value: "exercise-uses-equipment" } }),
					objectContaining({ right: { type: "literal", value: "exercise-equipment" } }),
				]),
			}),
		);
	});
});
