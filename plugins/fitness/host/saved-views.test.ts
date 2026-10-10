import { describe, expect, it } from "vitest";

import { fitnessSavedViews } from "./saved-views";

describe("fitness saved-view presentations", () => {
	it("selects card data in every entity-browser row and nests workout sets", () => {
		for (const view of fitnessSavedViews()) {
			const query = view.dataSources.queries.savedView;
			if (query?.output.type !== "rows") {
				throw new Error("Expected saved-view rows query");
			}
			const fields = query.output.fields.flatMap((selection) =>
				"key" in selection ? [selection.key] : [],
			);
			expect(fields).toContain("presentationName");
			if (view.slug === "all-workouts") {
				expect(fields).toEqual(
					expect.arrayContaining([
						"presentationStartedAt",
						"presentationEndedAt",
						"presentationExerciseNotes",
					]),
				);
				expect(query.output.include).toEqual([
					expect.objectContaining({
						limit: 100,
						key: "presentationSets",
						from: { table: "event", alias: "presentationWorkoutSet" },
					}),
				]);
			} else {
				expect(fields).toEqual(
					expect.arrayContaining([
						"presentationImage",
						"presentationPrimary",
						"presentationSecondary",
						"presentationCallout",
					]),
				);
				expect(query.output.include).toBeUndefined();
			}
		}
	});

	it("projects one exercise image locator instead of the image array", () => {
		const exercise = fitnessSavedViews()[0]?.dataSources.queries.savedView;
		if (exercise?.output.type !== "rows") {
			throw new Error("Expected exercise saved-view rows query");
		}
		const image = exercise.output.fields.find(
			(selection) => "key" in selection && selection.key === "presentationImage",
		);
		expect(image).toMatchObject({
			expr: expect.objectContaining({ type: "jsonPath", path: ["images", 0] }),
		});
	});
});
