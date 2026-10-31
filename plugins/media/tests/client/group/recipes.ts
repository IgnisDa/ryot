import { mediaGroupRecipes } from "../../../shared/group-recipes";
import { flatFixtureRecipes } from "../flat-media/recipes";

export const groupFixtureRecipes = mediaGroupRecipes({
	slug: "movie-group",
	alias: "groupFixture",
	member: flatFixtureRecipes,
});

export const creditGroupFixtureRecipes = mediaGroupRecipes({
	slug: "music-group",
	member: flatFixtureRecipes,
	alias: "creditGroupFixture",
});
