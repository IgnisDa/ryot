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
		});
		const exercises = recipe.document.queries["exercises"];
		if (exercises?.output.type !== "rows") {
			throw new Error("Expected exercise rows query");
		}

		expect(exercises.where).toEqual(
			expect.objectContaining({
				predicates: expect.arrayContaining([
					expect.objectContaining({
						operator: "eq",
						right: { type: "literal", value: "exercise" },
						left: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
					}),
					expect.objectContaining({
						operator: "eq",
						right: { type: "literal", value: "exercise-id" },
						left: { field: "id", type: "column", tableAlias: "entity" },
					}),
					expect.objectContaining({
						operator: "eq",
						right: { type: "literal", value: "Push Up" },
						left: { field: "name", type: "column", tableAlias: "entity" },
					}),
				]),
			}),
		);
		expect(exerciseListRecipe({}).document.queries.exercises?.where).toEqual({
			type: "and",
			predicates: [
				{
					operator: "eq",
					type: "comparison",
					right: { type: "literal", value: "exercise" },
					left: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
				},
			],
		});
		expect(exercises.output).toEqual(
			expect.objectContaining({
				pagination: { limit: 5, after: "exercise-cursor" },
				orderBy: [expect.objectContaining({ direction: "asc" })],
				include: [
					expect.objectContaining({
						limit: 100,
						key: "equipment",
						from: { table: "relationship", alias: "exerciseEquipmentRelationship" },
						joins: [
							expect.objectContaining({ table: { table: "entity", alias: "exerciseEquipment" } }),
						],
					}),
				],
				fields: expect.arrayContaining([
					expect.objectContaining({
						key: "image",
						expr: expect.objectContaining({ type: "jsonPath", path: ["images", 0] }),
					}),
					expect.objectContaining({
						key: "level",
						expr: expect.objectContaining({ type: "cast", target: "text" }),
					}),
				]),
			}),
		);
		expect(exercises.output.fields).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ key: "equipment" })]),
		);
	});

	it("uses the plural workouts include for template detail", () => {
		const recipe = workoutTemplateDetailRecipe({ workoutLimit: 6, entityId: "template-id" });
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
		const workoutRecipe = workoutDetailRecipe({ templateLimit: 3, entityId: "workout-id" });
		const templateRecipe = workoutTemplateDetailRecipe({
			workoutLimit: 4,
			entityId: "template-id",
		});
		const workout = workoutRecipe.document.queries["workout"];
		const workoutTemplate = templateRecipe.document.queries["workoutTemplate"];
		if (workout?.output.type !== "rows" || workoutTemplate?.output.type !== "rows") {
			throw new Error("Expected workout detail rows queries");
		}

		expect(workout.output).toEqual(
			expect.objectContaining({
				fields: expect.arrayContaining([
					expect.objectContaining({
						key: "startedAt",
						expr: expect.objectContaining({ type: "cast", target: "date" }),
					}),
					expect.objectContaining({
						key: "caloriesBurnt",
						expr: expect.objectContaining({ type: "cast", target: "number" }),
					}),
				]),
				include: expect.arrayContaining([
					expect.objectContaining({
						limit: 3,
						key: "template",
						from: { table: "relationship", alias: "templateRelationship" },
						joins: expect.arrayContaining([
							expect.objectContaining({
								on: expect.objectContaining({
									right: expect.objectContaining({ field: "id", tableAlias: "template" }),
									left: expect.objectContaining({
										field: "targetEntityId",
										tableAlias: "templateRelationship",
									}),
								}),
							}),
						]),
						where: expect.objectContaining({
							predicates: expect.arrayContaining([
								expect.objectContaining({
									right: expect.objectContaining({ field: "id", tableAlias: "entity" }),
									left: expect.objectContaining({
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
			expect.objectContaining({
				include: expect.arrayContaining([
					expect.objectContaining({
						limit: 4,
						key: "workouts",
						from: { table: "relationship", alias: "workoutRelationship" },
						joins: expect.arrayContaining([
							expect.objectContaining({
								on: expect.objectContaining({
									right: expect.objectContaining({ field: "id", tableAlias: "workout" }),
									left: expect.objectContaining({
										field: "sourceEntityId",
										tableAlias: "workoutRelationship",
									}),
								}),
							}),
						]),
						where: expect.objectContaining({
							predicates: expect.arrayContaining([
								expect.objectContaining({
									right: expect.objectContaining({ field: "id", tableAlias: "entity" }),
									left: expect.objectContaining({
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

	it("decodes exercise equipment relationships and removes duplicate equipment ids", () => {
		const recipe = exerciseListRecipe({});
		expect(
			recipe.decode({
				data: {
					exercises: {
						type: "rows",
						pageInfo: { limit: 20, hasMore: false, nextCursor: null },
						items: [
							{
								image: null,
								name: "Push Up",
								id: "exercise-1",
								kind: "strength",
								level: "beginner",
								schemaSlug: "exercise",
								equipment: {
									type: "rows",
									pageInfo: { limit: 100, hasMore: false, nextCursor: null },
									items: [
										{ name: "Barbell", id: "equipment-1" },
										{ name: "Barbell", id: "equipment-1" },
									],
								},
							},
						],
					},
				},
			}),
		).toMatchObject({
			success: {
				items: [
					{
						id: "exercise-1",
						level: "beginner",
						equipment: [{ name: "Barbell", id: "equipment-1" }],
					},
				],
			},
		});
	});

	it("queries shared and user-owned taxonomy entities and their exercise relationships", () => {
		const targetList = targetListRecipe({ limit: 4, name: "Lats", after: "target-cursor" });
		const targetRows = targetList.document.queries.targets;
		const equipmentList = equipmentListRecipe({ limit: 5 });
		const equipmentRows = equipmentList.document.queries.equipment;
		const targets = exerciseTargetsRecipe({
			limit: 3,
			exerciseId: "exercise-1",
			after: "relationship-cursor",
		});
		const targetRelationships = targets.document.queries.targets;
		const equipment = exerciseEquipmentRecipe({ limit: 2, exerciseId: "exercise-1" });
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
			expect.objectContaining({
				predicates: expect.arrayContaining([
					expect.objectContaining({ right: { type: "literal", value: "exercise-target" } }),
					expect.objectContaining({ right: { value: "Lats", type: "literal" } }),
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
				expect.objectContaining({ right: { type: "literal", value: "exercise-equipment" } }),
			],
		});
		expect(targetRelationships.output).toMatchObject({
			pagination: { limit: 3, after: "relationship-cursor" },
			orderBy: [
				expect.objectContaining({ direction: "asc" }),
				expect.objectContaining({ direction: "asc" }),
			],
			fields: expect.arrayContaining([
				expect.objectContaining({ key: "relationshipId" }),
				expect.objectContaining({ key: "id" }),
				expect.objectContaining({ key: "userId" }),
				expect.objectContaining({ key: "kind" }),
				expect.objectContaining({ key: "role" }),
			]),
		});
		expect(targetRelationships.where).toEqual(
			expect.objectContaining({
				predicates: expect.arrayContaining([
					expect.objectContaining({ right: { type: "literal", value: "exercise-1" } }),
					expect.objectContaining({ right: { type: "literal", value: "exercise-targets" } }),
					expect.objectContaining({ right: { type: "literal", value: "exercise-target" } }),
				]),
			}),
		);
		expect(equipmentRelationships.where).toEqual(
			expect.objectContaining({
				predicates: expect.arrayContaining([
					expect.objectContaining({ right: { type: "literal", value: "exercise-uses-equipment" } }),
					expect.objectContaining({ right: { type: "literal", value: "exercise-equipment" } }),
				]),
			}),
		);
	});
});
