import { describe, expect, it } from "vitest";

import {
	exerciseListRecipe,
	workoutDetailRecipe,
	workoutTemplateDetailRecipe,
} from "./query-recipes";

describe("fitness query recipes", () => {
	it("builds typed filtered exercise rows", () => {
		const recipe = exerciseListRecipe({
			after: "exercise-cursor",
			limit: 5,
			name: "Push Up",
			entityId: "exercise-id",
		});
		const exercises = recipe.document.queries["exercises"];
		if (exercises?.output.type !== "rows") {
			throw new Error("Expected exercise rows query");
		}

		expect(exercises.where).toEqual(
			expect.objectContaining({
				predicates: expect.arrayContaining([
					expect.objectContaining({
						right: { type: "literal", value: "exercise" },
						left: expect.objectContaining({ field: "entitySchemaSlug" }),
					}),
					expect.objectContaining({
						right: { type: "literal", value: "exercise-id" },
						left: expect.objectContaining({ field: "id" }),
					}),
					expect.objectContaining({
						right: { type: "literal", value: "Push Up" },
						left: expect.objectContaining({ field: "name" }),
					}),
				]),
			}),
		);
		expect(exercises.output).toEqual(
			expect.objectContaining({
				pagination: { after: "exercise-cursor", limit: 5 },
				orderBy: [expect.objectContaining({ direction: "asc" })],
				fields: expect.arrayContaining([
					expect.objectContaining({
						key: "image",
						expr: expect.objectContaining({ path: ["images", 0], type: "jsonPath" }),
					}),
					expect.objectContaining({
						key: "level",
						expr: expect.objectContaining({ target: "text", type: "cast" }),
					}),
				]),
			}),
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
					from: { alias: "workoutRelationship", table: "relationship" },
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
				include: expect.arrayContaining([
					expect.objectContaining({
						limit: 3,
						key: "template",
						from: { alias: "templateRelationship", table: "relationship" },
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
					}),
				]),
				fields: expect.arrayContaining([
					expect.objectContaining({
						key: "startedAt",
						expr: expect.objectContaining({ target: "date", type: "cast" }),
					}),
					expect.objectContaining({
						key: "caloriesBurnt",
						expr: expect.objectContaining({ target: "number", type: "cast" }),
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
						from: { alias: "workoutRelationship", table: "relationship" },
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
					}),
				]),
			}),
		);
	});

	it("decodes plain selected exercise values", () => {
		const recipe = exerciseListRecipe({});
		expect(
			recipe.decode({
				data: {
					exercises: {
						type: "rows",
						pageInfo: { hasMore: false, limit: 20, nextCursor: null },
						items: [
							{
								id: "exercise-1",
								name: "Push Up",
								image: null,
								level: "beginner",
								kind: "strength",
								equipment: null,
								schemaSlug: "exercise",
							},
						],
					},
				},
			}),
		).toMatchObject({ success: { items: [{ id: "exercise-1", level: "beginner" }] } });
	});
});
