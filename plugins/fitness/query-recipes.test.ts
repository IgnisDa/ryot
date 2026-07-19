import { describe, expect, it } from "vitest";

import {
	buildExerciseListQueryDocument,
	buildWorkoutDetailQueryDocument,
	buildWorkoutTemplateDetailQueryDocument,
} from "./query-recipes";

describe("fitness query recipes", () => {
	it("builds typed filtered exercise rows", () => {
		const doc = buildExerciseListQueryDocument({
			page: 2,
			limit: 5,
			name: "Push Up",
			entityId: "exercise-id",
		});

		expect(doc.queries.exercises.where).toEqual(
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
		expect(doc.queries.exercises.output).toEqual(
			expect.objectContaining({
				pagination: { limit: 5, page: 2 },
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
		const doc = buildWorkoutTemplateDetailQueryDocument({
			workoutLimit: 6,
			entityId: "template-id",
		});

		expect(doc.queries.workoutTemplate.output).toMatchObject({
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
		const workoutDoc = buildWorkoutDetailQueryDocument({
			templateLimit: 3,
			entityId: "workout-id",
		});
		const templateDoc = buildWorkoutTemplateDetailQueryDocument({
			workoutLimit: 4,
			entityId: "template-id",
		});

		expect(workoutDoc.queries.workout.output).toEqual(
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
		expect(templateDoc.queries.workoutTemplate.output).toEqual(
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
});
