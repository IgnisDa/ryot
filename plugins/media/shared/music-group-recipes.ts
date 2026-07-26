import { mediaGroupRecipes } from "./group-recipes";
import { musicRecipes } from "./music-recipes";

export const musicGroupRecipes = mediaGroupRecipes({
	slug: "music-group",
	alias: "musicGroup",
	member: musicRecipes,
});
