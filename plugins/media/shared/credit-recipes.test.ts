import { describe, expect, it } from "bun:test";

import type { RyotQLDocument as ImportedRyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";
import { arrayContaining } from "@ryot-app/testing/matchers";

import { companyRecipes } from "./company-recipes";
import { mediaPeopleRecipe } from "./media-recipes";
import { movieRecipes } from "./movie-recipes";
import { musicGroupRecipes } from "./music-group-recipes";
import { personRecipes } from "./person-recipes";
import { showRecipes } from "./show-recipes";

const rowsQuery = (
	recipe: { document: ImportedRyotQLDocument; decode: Recipe<unknown, AppSchema>["decode"] },
	name: string,
) => {
	const query = recipe.document.queries[name];
	if (query?.output.type !== "rows") {
		throw new Error(`Expected ${name} rows`);
	}
	return { ...query, output: query.output };
};

describe("credit pagination recipes", () => {
	it("uses identical company ordering for bounded previews and cursor pages without person metadata", () => {
		const overview = bindRecipe(movieRecipes.overviewRecipe({ reference: { kind: "self" } }), {
			entityId: "movie-1",
		});
		const preview = rowsQuery(overview, "companies");
		for (const recipes of [movieRecipes, showRecipes, musicGroupRecipes]) {
			for (const after of [undefined, "company-page-1", "company-page-2"]) {
				const query = rowsQuery(
					bindRecipe(recipes.companiesRecipe({ reference: { kind: "self" } }), {
						limit: 30,
						after: after,
						entityId: "media-1",
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

	it("pages all movie and show credits without kind or appearance restrictions", () => {
		for (const recipes of [movieRecipes, showRecipes]) {
			for (const after of [undefined, "people-page-1", "people-page-2"]) {
				const query = rowsQuery(
					bindRecipe(recipes.peopleRecipe({ reference: { kind: "self" } }), {
						limit: 30,
						after: after,
						entityId: "media-1",
					}),
					"people",
				);
				expect(query.output.pagination).toEqual({
					limit: 30,
					...(after === undefined ? {} : { after }),
				});
				const where = JSON.stringify(query.where);
				expect(where).not.toContain("creditKinds");
				expect(where).not.toContain("isGuest");
				expect(where).not.toContain("isUncredited");
			}
		}
	});

	it("pages incoming people in credit order with roles and character names", () => {
		const query = rowsQuery(
			bindRecipe(movieRecipes.peopleRecipe({ reference: { kind: "self" } }), {
				limit: 30,
				after: "cursor-1",
				entityId: "movie-1",
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
		expect(
			query.output.fields.map((field) => ("key" in field ? field.key : null)),
		).toEqual<unknown>(
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
			bindRecipe(recipe({ reference: { kind: "self" } }), { limit: 30, entityId: "group-1" }),
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
		} satisfies Recipe.Arguments<ReturnType<typeof personRecipes.creditsRecipe>> & {
			readonly limit: number;
			readonly after: string;
			readonly reference: PluginIdentityReference;
		};
		const person = rowsQuery(
			bindRecipe(personRecipes.creditsRecipe({ reference: input.reference }), {
				after: input.after,
				limit: input.limit,
				target: input.target,
				entityId: input.entityId,
			}),
			"credits",
		);
		const company = rowsQuery(
			bindRecipe(companyRecipes.creditsRecipe({ reference: input.reference }), {
				after: input.after,
				limit: input.limit,
				target: input.target,
				entityId: input.entityId,
			}),
			"credits",
		);
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
			bindRecipe(personRecipes.creditsRecipe({ reference: { kind: "self" } }), {
				limit: 30,
				entityId: "person-1",
				target: "music-group",
			}),
			"credits",
		);
		expect(JSON.stringify(query)).not.toContain("publishYear");
		expect(
			query.output.fields.find((field) => "key" in field && field.key === "character"),
		).toEqual({ key: "character", expr: { value: null, type: "literal" } });
		expect(query.output.orderBy).toMatchObject([
			{ direction: "asc", expr: { field: "name" } },
			{ direction: "asc", expr: { field: "id" } },
		]);
	});
});
