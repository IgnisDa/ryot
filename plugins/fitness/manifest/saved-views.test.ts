import { describe, expect, it } from "bun:test";

import { objectContaining } from "@ryot-app/testing/matchers";

import { fitnessPlugin } from "./plugin";
import { fitnessSavedViews } from "./saved-views";

const savedView = (slug: string) =>
	fitnessSavedViews().find((candidate) => candidate.slug === slug);

describe("fitness saved-view presentations", () => {
	it("projects one exercise image locator instead of the image array", () => {
		const image = fitnessPlugin.client.entities.exercise.presentation.entity.find(
			(selection) => selection.key === "presentationImage",
		);
		expect(image).toEqual<unknown>(
			objectContaining({ expr: objectContaining({ type: "jsonPath", path: ["images", 0] }) }),
		);
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

	it("orders exercises by times performed and templates by creation", () => {
		const exercise = savedView("all-exercises");
		const templates = savedView("all-workout-templates");
		expect(JSON.stringify(exercise?.dataSources)).toContain('"function":"countDistinct"');
		expect(JSON.stringify(templates?.dataSources)).toContain('"field":"createdAt"');
		expect(exercise?.settings).not.toHaveProperty("filterFields");
	});
});
