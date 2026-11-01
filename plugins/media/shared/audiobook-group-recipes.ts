import { audiobookRecipes } from "./audiobook-recipes";
import { mediaGroupRecipes } from "./group-recipes";

export const audiobookGroupRecipes = mediaGroupRecipes({
	slug: "audiobook-group",
	alias: "audiobookGroup",
	member: audiobookRecipes,
});
