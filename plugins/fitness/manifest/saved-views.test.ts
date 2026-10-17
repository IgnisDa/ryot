import { castText, column, inArray, jsonPath, literal, table } from "@ryot-app/ryotql";
import { compileFilter } from "@ryot-app/ryotql-recipes/saved-view-filters";
import { DateTime, Result } from "effect";
import { describe, expect, it } from "vitest";

import { exerciseFilterFields, fitnessSavedViews } from "./saved-views";

describe("fitness saved-view presentations", () => {
	it("selects card data in every entity-browser row", () => {
		for (const view of fitnessSavedViews()) {
			if (view.dataSources === null) {
				continue;
			}
			const { output } = view.dataSources.queries.savedView;
			const fields = output.fields.flatMap((selection) =>
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
			expect(output.include).toBeUndefined();
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

	it("declares exercise filters over untransformed raw-value projections", () => {
		const exercise = fitnessSavedViews()[0];
		const query = exercise?.dataSources?.queries.savedView;
		if (exercise?.slug !== "all-exercises" || query?.output.type !== "rows") {
			throw new Error("Expected the All Exercises rows source");
		}
		const filterFields = exerciseFilterFields();
		expect(exercise.settings).toMatchObject({ filterFields });
		expect(filterFields.map(({ key }) => key)).toEqual([
			"level",
			"force",
			"mechanic",
			"kind",
			"muscles",
			"equipment",
		]);
		const level = filterFields[0];
		expect(level).toMatchObject({
			key: "level",
			type: "enum",
			label: "Level",
			field: "levelValue",
			choices: expect.arrayContaining([{ value: "beginner", label: "beginner" }]),
		});
		const properties = column(table("entity", "entity"), "properties");
		const fields = filterFields.flatMap((candidate) =>
			candidate.kind === "value" ? [candidate] : [],
		);
		const predicate = compileFilter({
			fields,
			subject: undefined,
			now: DateTime.makeUnsafe(0),
			source: { ...query, output: query.output },
			filter: { field: "level", operator: "anyOf", values: ["beginner"] },
		});
		expect(Result.getOrThrow(predicate)).toEqual(
			inArray(castText(jsonPath(properties, "level")), [literal("beginner")]),
		);
		const display = query.output.fields.find(
			(selection) => "key" in selection && selection.key === "level",
		);
		expect(JSON.stringify(display)).toContain("titleCase");
	});

	it("targets the exercise muscles and equipment relationships", () => {
		expect(exerciseFilterFields().slice(4)).toEqual([
			expect.objectContaining({
				kind: "relationship",
				direction: "outgoing",
				relationship: { owner: { kind: "self" }, slug: "exercise-targets" },
			}),
			expect.objectContaining({
				kind: "relationship",
				direction: "outgoing",
				relationship: { owner: { kind: "self" }, slug: "exercise-uses-equipment" },
			}),
		]);
	});
});
