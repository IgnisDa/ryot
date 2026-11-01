import { videoGameGroupRecipes } from "../../shared/video-game-group-recipes";
import { defineGroupMediaSchema } from "../media/group-schema";
import { mediaSchemaAspects } from "../schema-aspects";
import { videoGameSchema } from "../video-game/schema";

export const videoGameGroupSchema = defineGroupMediaSchema({
	member: videoGameSchema,
	recipes: videoGameGroupRecipes,
	aspect: mediaSchemaAspects["video-game-group"],
	members: { tab: "Games", noun: "game", verb: "played" },
	creditCopy: { people: "People", notice: "Credits", companies: "Companies" },
	nouns: { plural: "collections", singular: "collection", title: "Game collection" },
});
