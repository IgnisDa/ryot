import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import { companyRecipes } from "./company-recipes";
import { mediaPeopleRecipe } from "./media-recipes";
import { movieRecipes } from "./movie-recipes";
import { personRecipes } from "./person-recipes";

const rowsQuery = (recipe: PreparedRecipe<unknown>, name: string) => {
	const query = recipe.document.queries[name];
	if (query?.output.type !== "rows") {
		throw new Error(`Expected ${name} rows`);
	}
	return { ...query, output: query.output };
};

describe("credit pagination recipes", () => {
	it("pages incoming people in credit order with roles and character names", () => {
		const query = rowsQuery(
			movieRecipes.peopleRecipe({
				limit: 30,
				after: "cursor-1",
				entityId: "movie-1",
				reference: { kind: "self" },
			}),
			"people",
		);
		expect(query.from.table).toBe("relationship");
		expect(query.output.pagination).toEqual({ limit: 30, after: "cursor-1" });
		expect(query.output.orderBy).toMatchObject([
			{ direction: "asc", expr: { type: "cast", expr: { path: ["order"] } } },
			{ direction: "asc", expr: { field: "name" } },
			{ direction: "asc", expr: { field: "id" } },
		]);
		expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual(
			expect.arrayContaining(["roles", "character"]),
		);
		expect(JSON.stringify(query.where)).toContain("person-to-movie");
		expect(JSON.stringify(query.where)).toContain("movie-1");
	});

	it("does not select character fields for group people", () => {
		const recipe = mediaPeopleRecipe({ slug: "music-group", personFields: () => ({}) });
		const query = rowsQuery(
			recipe({ limit: 30, entityId: "group-1", reference: { kind: "self" } }),
			"people",
		);
		expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).not.toContain(
			"character",
		);
		expect(JSON.stringify(query.where)).toContain("person-to-music-group");
	});

	it("pages creator media newest first and restricts characters to person credits", () => {
		const input = {
			limit: 30,
			target: "movie",
			after: "cursor-2",
			entityId: "creator-1",
			reference: { kind: "self" },
		} satisfies Parameters<typeof personRecipes.creditsRecipe>[0];
		const person = rowsQuery(personRecipes.creditsRecipe(input), "credits");
		const company = rowsQuery(companyRecipes.creditsRecipe(input), "credits");
		expect(person.output.pagination).toEqual({ limit: 30, after: "cursor-2" });
		expect(person.output.orderBy[0]).toMatchObject({
			direction: "desc",
			expr: { type: "cast", expr: { path: ["publishYear"] } },
		});
		expect(person.output.fields.map((field) => ("key" in field ? field.key : null))).toContain(
			"character",
		);
		expect(company.output.fields.map((field) => ("key" in field ? field.key : null))).not.toContain(
			"character",
		);
		expect(JSON.stringify(person.where)).toContain("person-to-movie");
		expect(JSON.stringify(company.where)).toContain("company-to-movie");
	});

	it("never reads undeclared year or character properties from creator group credits", () => {
		const query = rowsQuery(
			personRecipes.creditsRecipe({
				limit: 30,
				entityId: "person-1",
				target: "music-group",
				reference: { kind: "self" },
			}),
			"credits",
		);
		expect(JSON.stringify(query)).not.toContain("publishYear");
		expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).not.toContain(
			"character",
		);
		expect(query.output.orderBy).toMatchObject([
			{ direction: "asc", expr: { field: "name" } },
			{ direction: "asc", expr: { field: "id" } },
		]);
	});
});
