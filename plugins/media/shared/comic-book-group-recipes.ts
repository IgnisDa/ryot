import { comicBookRecipes } from "./comic-book-recipes";
import { mediaGroupRecipes } from "./group-recipes";

export const comicBookGroupRecipes = mediaGroupRecipes({
	alias: "comicBookGroup",
	slug: "comic-book-group",
	member: comicBookRecipes,
});
