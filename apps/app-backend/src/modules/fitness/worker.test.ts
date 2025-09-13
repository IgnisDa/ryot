import { describe, expect, it } from "bun:test";
import { buildExerciseSeedEntityValues } from "./worker";

describe("buildExerciseSeedEntityValues", () => {
	it("maps upstream equipment values to schema-safe snake_case", () => {
		const now = new Date("2024-01-02T00:00:00.000Z");

		const result = buildExerciseSeedEntityValues(
			"exercise_schema_1",
			{
				force: "pull",
				level: "beginner",
				name: "EZ Bar Curl",
				category: "strength",
				mechanic: "isolation",
				equipment: "e-z curl bar",
				primaryMuscles: ["biceps"],
				images: ["EZ_Bar_Curl/0.jpg"],
				secondaryMuscles: ["forearms"],
				instructions: ["Curl the bar."],
			},
			now,
		);

		expect(result).toEqual({
			status: "ready",
			values: {
				userId: null,
				populatedAt: now,
				name: "EZ Bar Curl",
				sandboxScriptId: null,
				externalId: "EZ Bar Curl",
				entitySchemaId: "exercise_schema_1",
				image: {
					kind: "remote",
					url: "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/EZ_Bar_Curl/0.jpg",
				},
				properties: {
					force: "pull",
					source: "github",
					level: "beginner",
					mechanic: "isolation",
					kind: "reps_and_weight",
					equipment: "ez_curl_bar",
					muscles: ["biceps", "forearms"],
					instructions: ["Curl the bar."],
					images: [
						{
							kind: "remote",
							url: "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/EZ_Bar_Curl/0.jpg",
						},
					],
				},
			},
		});
	});

	it("skips rows whose normalized properties do not satisfy the schema", () => {
		const result = buildExerciseSeedEntityValues(
			"exercise_schema_1",
			{
				images: [],
				force: "pull",
				level: "legendary",
				equipment: "barbell",
				category: "strength",
				secondaryMuscles: [],
				mechanic: "isolation",
				name: "Mystery Exercise",
				primaryMuscles: ["biceps"],
				instructions: ["Do the thing."],
			},
			new Date("2024-01-02T00:00:00.000Z"),
		);

		expect(result).toEqual({
			status: "skipped",
			reason: "invalid exercise properties for: Mystery Exercise",
		});
	});
});
