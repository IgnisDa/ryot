import { videoGameGroupRecipes } from "../../shared/video-game-group-recipes";
import { defineGroupMediaSchema } from "../media/group-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaSchemaAspects } from "../schema-aspects";
import { videoGameSchema } from "../video-game/schema";

export const videoGameGroupSchema = defineGroupMediaSchema({
	member: videoGameSchema,
	recipes: videoGameGroupRecipes,
	heroHeight: () => MEDIA_ART_HEIGHT,
	aspect: mediaSchemaAspects["video-game-group"],
	members: { tab: "Games", noun: "game", verb: "played" },
	creditCopy: { people: "People", notice: "Credits", companies: "Companies" },
	nouns: { plural: "collections", singular: "collection", title: "Game collection" },
});
