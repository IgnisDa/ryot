import { musicGroupRecipes } from "../../shared/music-group-recipes";
import { defineGroupMediaSchema } from "../media/group-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { musicSchema } from "../music/schema";
import { mediaSchemaAspects } from "../schema-aspects";

export const musicGroupSchema = defineGroupMediaSchema({
	member: musicSchema,
	recipes: musicGroupRecipes,
	heroHeight: () => MEDIA_ART_HEIGHT,
	aspect: mediaSchemaAspects["music-group"],
	members: { tab: "Tracks", noun: "track", verb: "listened" },
	nouns: { title: "Album", plural: "albums", singular: "album" },
	creditCopy: { people: "Artists", companies: "Labels", notice: "Artists and labels" },
});
