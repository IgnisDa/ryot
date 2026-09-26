import { bookRecipes } from "./book-recipes";
import { mediaGroupRecipes } from "./group-recipes";

export const bookGroupRecipes = mediaGroupRecipes({
	slug: "book-group",
	alias: "bookGroup",
	member: bookRecipes,
});
