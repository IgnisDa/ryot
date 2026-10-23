import { expect, it } from "vitest";

import {
	workoutExerciseCollectionOptionsRecipe,
	workoutExercisePickerRecipe,
} from "./workout-exercise-recipes";

it("filters the paged exercise picker by selected categories and includes taxonomy labels", () => {
	const recipe = workoutExercisePickerRecipe({
		sort: "name",
		search: "  bench  ",
		forces: ["pull", "push"],
		after: "exercise-cursor",
		reference: { kind: "self" },
		levels: ["beginner", "expert"],
		targetIds: ["target-1", "target-2"],
		mechanics: ["compound", "isolation"],
		kinds: ["reps_and_weight", "duration"],
		equipmentIds: ["equipment-1", "equipment-2"],
		collectionIds: ["collection-1", "collection-2"],
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
	expect(where).toContain('"value":"duration"');
	expect(where).toContain('"value":"pull"');
	expect(where).toContain('"value":"push"');
	expect(where).toContain('"value":"beginner"');
	expect(where).toContain('"value":"expert"');
	expect(where).toContain('"value":"compound"');
	expect(where).toContain('"value":"isolation"');
	expect(where).toContain('"field":"relationshipSchemaPluginId"');
	expect(where).toContain('"field":"entitySchemaPluginId"');
	expect(where).toContain('"reference":{"kind":"self"}');
	expect(where).toContain('"alias":"pickerLibraryRelationship"');
	expect(where).toContain('"value":"in-fitness-library"');
	expect(where).toContain('"alias":"pickerTargetRelationship"');
	expect(where).toContain('"value":"exercise-targets"');
	expect(where).toContain('"alias":"sharedTaxonomyRelationship"');
	expect(where).toContain('"value":"target-1"');
	expect(where).toContain('"alias":"pickerEquipmentRelationship"');
	expect(where).toContain('"value":"exercise-uses-equipment"');
	expect(where).toContain('"value":"equipment-1"');
	expect(where).toContain('"alias":"pickerCollectionRelationship"');
	expect(where).toContain('"value":"member-of"');
	expect(where).toContain('"value":"collection"');
	expect(where).toContain('"type":"in"');
	expect(where).toContain('"type":"isNull"');
	const include = JSON.stringify(query.output.include);
	expect(include).toContain('"key":"targets"');
	expect(include).toContain('"key":"equipment"');
	expect(include).toContain('"field":"name"');
	expect(include).toContain('"field":"targetEntityId"');
	const libraryMembership =
		query.where?.type === "and"
			? query.where.predicates.find(
					(predicate) =>
						predicate.type === "exists" && predicate.query.from.alias === "pickerLibrary",
				)
			: undefined;
	expect(libraryMembership).toBeDefined();
});

it("orders the picker by performed set count by default with a stable ID tie break", () => {
	const recipe = workoutExercisePickerRecipe({ reference: { kind: "self" } });
	const query = recipe.document.queries.exercises;
	if (query?.output.type !== "rows") {
		throw new Error("Expected picker exercise rows");
	}
	expect(query.output.orderBy).toHaveLength(2);
	expect(query.output.orderBy[0]).toMatchObject({ direction: "desc", expr: { type: "aggregate" } });
	expect(JSON.stringify(query.output.orderBy[0])).toContain('"function":"count"');
	expect(JSON.stringify(query.output.orderBy[0])).toContain('"value":"workout-set"');
	expect(query.output.orderBy[1]).toEqual({
		direction: "asc",
		expr: { field: "id", type: "column", tableAlias: "pickerExercise" },
	});
});

it("pages visible collection filter options by name", () => {
	const recipe = workoutExerciseCollectionOptionsRecipe({ after: "collection-cursor" });
	const query = recipe.document.queries.collections;
	if (query?.output.type !== "rows") {
		throw new Error("Expected collection option rows");
	}
	expect(query.output.pagination).toEqual({ limit: 100, after: "collection-cursor" });
	expect(query.output.orderBy).toEqual([
		{
			direction: "asc",
			expr: { field: "name", type: "column", tableAlias: "pickerCollectionOption" },
		},
		{
			direction: "asc",
			expr: { field: "id", type: "column", tableAlias: "pickerCollectionOption" },
		},
	]);
	expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
		"id",
		"name",
	]);
	expect(JSON.stringify(query.where)).toContain('"value":"collection"');
});
