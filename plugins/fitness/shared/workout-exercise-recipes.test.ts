import { expect, it } from "vitest";

import { workoutExercisePickerRecipe } from "./workout-exercise-recipes";

it("pages fitness-library exercises by name with optional filters and library membership overrides", () => {
	const recipe = workoutExercisePickerRecipe({
		search: "  bench  ",
		targetId: "target-1",
		kind: "reps_and_weight",
		after: "exercise-cursor",
		equipmentId: "equipment-1",
		reference: { kind: "self" },
		collectionId: "collection-1",
	});
	const query = recipe.document.queries.exercises;
	if (query?.output.type !== "rows") {
		throw new Error("Expected picker exercise rows");
	}
	expect(query.output.pagination).toEqual({ limit: 100, after: "exercise-cursor" });
	expect(query.output.orderBy).toEqual([
		{ direction: "asc", expr: { field: "name", type: "column", tableAlias: "pickerExercise" } },
		{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "pickerExercise" } },
	]);
	expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual(
		expect.arrayContaining([
			"id",
			"name",
			"kind",
			"images",
			"instructions",
			"videos",
			"membershipProperties",
		]),
	);
	const where = JSON.stringify(query.where);
	expect(where).toContain('"value":"bench"');
	expect(where).toContain('"value":"reps_and_weight"');
	expect(where).toContain('"field":"relationshipSchemaPluginId"');
	expect(where).toContain('"field":"entitySchemaPluginId"');
	expect(where).toContain('"reference":{"kind":"self"}');
	expect(where).toContain('"alias":"pickerLibraryRelationship"');
	expect(where).toContain('"value":"in-fitness-library"');
	expect(where).toContain('"alias":"pickerTargetRelationship"');
	expect(where).toContain('"value":"exercise-targets"');
	expect(where).toContain('"value":"target-1"');
	expect(where).toContain('"alias":"pickerEquipmentRelationship"');
	expect(where).toContain('"value":"exercise-uses-equipment"');
	expect(where).toContain('"value":"equipment-1"');
	expect(where).toContain('"alias":"pickerCollectionRelationship"');
	expect(where).toContain('"value":"member-of"');
	expect(where).toContain('"value":"collection"');
	expect(where).toContain('"type":"isNull"');
	const libraryMembership =
		query.where?.type === "and"
			? query.where.predicates.find(
					(predicate) =>
						predicate.type === "exists" && predicate.query.from.alias === "pickerLibrary",
				)
			: undefined;
	expect(libraryMembership).toBeDefined();
});
