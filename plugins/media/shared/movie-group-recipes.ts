import { mediaGroupRecipes } from "./group-recipes";
import { movieRecipes } from "./movie-recipes";

export const movieGroupRecipes = mediaGroupRecipes({
	slug: "movie-group",
	alias: "movieGroup",
	member: movieRecipes,
});
