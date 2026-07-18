import { describe, expect, it } from "vitest";

import { buildWorkoutTemplateDetailQueryDocument } from "./query-recipes";

describe("fitness query recipes", () => {
	it("uses the plural workouts include for template detail", () => {
		const doc = buildWorkoutTemplateDetailQueryDocument({
			workoutLimit: 6,
			entityId: "template-id",
		});

		expect(doc.output.include?.[0]).toMatchObject({ key: "workouts", limit: 6 });
	});
});
