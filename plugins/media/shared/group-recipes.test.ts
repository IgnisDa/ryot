import { describe, expect, it } from "vitest";

import { creditGroupFixtureRecipes, groupFixtureRecipes } from "../tests/client/group/recipes";
import { withMemberCoverFallback } from "./group-recipes";

const cover = { type: "s3", purpose: "cover", key: "member-cover" } as const;

const backdrop = { type: "s3", purpose: "backdrop", key: "member-backdrop" } as const;

const own = { type: "s3", purpose: "cover", key: "group-cover" } as const;

const fieldKeys = (fields: readonly object[]) =>
	fields.map((field) => ("key" in field ? field.key : null));

describe("media group recipes", () => {
	it("keeps the group's own images and drops the member artwork", () => {
		expect(
			withMemberCoverFallback({ id: "group-1", images: [own], memberImages: [cover, backdrop] }),
		).toEqual({ id: "group-1", images: [own] });
	});

	it("falls back to only the first member's covers when the group has no images", () => {
		expect(withMemberCoverFallback({ images: [], memberImages: [backdrop, cover] })).toEqual({
			images: [cover],
		});
		expect(withMemberCoverFallback({ images: null, memberImages: [cover] })).toEqual({
			images: [cover],
		});
		expect(withMemberCoverFallback({ images: null, memberImages: null })).toEqual({ images: [] });
	});

	it("pages members from the cursor in relationship order, then name, then id", () => {
		const recipe = groupFixtureRecipes.membersRecipe({
			limit: 20,
			after: "cursor-1",
			groupId: "group-1",
		});
		const members = recipe.document.queries["members"];
		if (members?.output.type !== "rows") {
			throw new Error("Expected a members rows query");
		}

		expect(members.output.pagination).toEqual({ limit: 20, after: "cursor-1" });
		expect(members.output.orderBy).toMatchObject([
			{ direction: "asc", expr: { type: "cast", expr: { path: ["order"] } } },
			{ direction: "asc", expr: { field: "name", tableAlias: "groupFixtureMember" } },
			{ direction: "asc", expr: { field: "id", tableAlias: "groupFixtureMember" } },
		]);
		expect(members.where).toMatchObject({
			predicates: [
				{ right: { value: "movie", type: "literal" } },
				{ right: { type: "literal", value: "group-1" } },
				{ right: { type: "literal", value: "movie-group-to-movie" } },
			],
		});
		expect(fieldKeys(members.output.fields)).toContain("position");
	});

	it("declares credits only for a credit group, without a character", () => {
		expect("overviewRecipe" in groupFixtureRecipes).toBe(false);
		const recipe = creditGroupFixtureRecipes.overviewRecipe({
			peopleLimit: 12,
			companyLimit: 6,
			entityId: "group-1",
		});
		const people = recipe.document.queries["people"];
		if (people?.output.type !== "rows") {
			throw new Error("Expected a people rows query");
		}

		expect(Object.keys(recipe.document.queries)).toEqual(["companies", "people"]);
		expect(fieldKeys(people.output.fields)).not.toContain("character");
		expect(JSON.stringify(people.where)).toContain('"person-to-music-group"');
	});
});
