import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { arrayContaining } from "@ryot-app/testing/matchers";
import { describe, expect, it } from "vitest";

import { companyRecipes } from "./company-recipes";
import { mediaPeopleRecipe } from "./media-recipes";
import { movieRecipes } from "./movie-recipes";
import { musicGroupRecipes } from "./music-group-recipes";
import { personRecipes } from "./person-recipes";
import { showRecipes } from "./show-recipes";

const rowsQuery = (recipe: PreparedRecipe<unknown>, name: string) => {
	const query = recipe.document.queries[name];
	if (query?.output.type !== "rows") {
		throw new Error(`Expected ${name} rows`);
	}
	return { ...query, output: query.output };
};

describe("credit pagination recipes", () => {
	it("uses identical company ordering for bounded previews and cursor pages without person metadata", () => {
		const overview = movieRecipes.overviewRecipe({
			groupLimit: 20,
			peopleLimit: 12,
			companyLimit: 6,
			entityId: "movie-1",
			recommendationLimit: 12,
			reference: { kind: "self" },
		});
		const preview = rowsQuery(overview, "companies");
		for (const recipes of [movieRecipes, showRecipes, musicGroupRecipes]) {
			for (const after of [undefined, "company-page-1", "company-page-2"]) {
				const query = rowsQuery(
					recipes.companiesRecipe({
						after,
						limit: 30,
						entityId: "media-1",
						reference: { kind: "self" },
					}),
					"companies",
				);
				expect(query.output.pagination).toEqual({
					limit: 30,
					...(after === undefined ? {} : { after }),
				});
				expect(query.output.orderBy).toEqual(preview.output.orderBy);
				const fields = query.output.fields.map((field) => ("key" in field ? field.key : null));
				expect(fields).toContain("roles");
				for (const field of [
					"character",
					"creditKinds",
					"departments",
					"isGuest",
					"isUncredited",
					"publishYear",
				]) {
					expect(fields).not.toContain(field);
				}
			}
		}
		expect(preview.output.pagination).toEqual({ limit: 6 });
	});

	it("applies known kind and flag predicates before pagination and keeps defaults unfiltered", () => {
		for (const recipes of [movieRecipes, showRecipes]) {
			const input = {
				limit: 30,
				entityId: "media-1",
				reference: { kind: "self" },
			} satisfies Parameters<typeof movieRecipes.peopleRecipe>[0];
			const all = rowsQuery(recipes.peopleRecipe(input), "people");
			expect(JSON.stringify(all.where)).not.toContain("creditKinds");
			expect(JSON.stringify(all.where)).not.toContain("isGuest");
			expect(JSON.stringify(all.where)).not.toContain("isUncredited");
			for (const kind of ["cast", "crew"] satisfies readonly ("cast" | "crew")[]) {
				for (const after of [undefined, "people-page-1", "people-page-2"]) {
					const query = rowsQuery(
						recipes.peopleRecipe({
							...input,
							after,
							filters: { kind, guest: "exclude", uncredited: "only" },
						}),
						"people",
					);
					expect(query.output.pagination).toEqual({
						limit: 30,
						...(after === undefined ? {} : { after }),
					});
					const where = JSON.stringify(query.where);
					expect(where).toContain("creditKinds");
					expect(where).toContain(kind);
					expect(where).toContain("isGuest");
					expect(where).toContain("isNull");
					expect(where).toContain("isUncredited");
					expect(where).toContain('"value":true');
					expect(where).toContain('"value":false');
				}
			}
		}
	});

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
			arrayContaining([
				"roles",
				"character",
				"creditKinds",
				"departments",
				"isGuest",
				"isUncredited",
			]),
		);
		expect(JSON.stringify(query.where)).toContain("person-to-movie");
		expect(JSON.stringify(query.where)).toContain("movie-1");
		expect(JSON.stringify(query.where)).not.toContain("in-media-library");
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
		for (const field of ["creditKinds", "departments", "isGuest", "isUncredited"]) {
			expect(JSON.stringify(query)).not.toContain(field);
		}
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
