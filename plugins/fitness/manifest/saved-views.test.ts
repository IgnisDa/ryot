import { describe, expect, it } from "vitest";

import { fitnessSavedViews } from "./saved-views";

describe("fitness saved-view presentations", () => {
	it("selects card data in every entity-browser row", () => {
		for (const view of fitnessSavedViews()) {
			if (view.dataSources === null) {
				continue;
			}
			const query = view.dataSources.queries.savedView;
			if (query?.output.type !== "rows") {
				throw new Error("Expected saved-view rows query");
			}
			const fields = query.output.fields.flatMap((selection) =>
				"key" in selection ? [selection.key] : [],
			);
			expect(fields).toEqual(
				expect.arrayContaining([
					"presentationName",
					"presentationImage",
					"presentationPrimary",
					"presentationSecondary",
					"presentationCallout",
				]),
			);
			expect(query.output.include).toBeUndefined();
		}
	});

	it("projects one exercise image locator instead of the image array", () => {
		const exercise = fitnessSavedViews()[0]?.dataSources?.queries.savedView;
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

	it.each([
		["all-workouts", "All Workouts", "workouts", 1],
		["all-measurements", "All Measurements", "measurements", 2],
	] as const)(
		"renders %s with its plugin page and no data sources",
		(slug, name, exportName, sortOrder) => {
			expect(fitnessSavedViews().find((view) => view.slug === slug)).toMatchObject({
				name,
				sortOrder,
				settings: {},
				dataSources: null,
				renderer: { exportName, kind: "plugin" },
			});
		},
	);
});
