import { mediaGroupRecipes } from "./group-recipes";
import { videoGameRecipes } from "./video-game-recipes";

export const videoGameGroupRecipes = mediaGroupRecipes({
	alias: "videoGameGroup",
	slug: "video-game-group",
	member: videoGameRecipes,
});
