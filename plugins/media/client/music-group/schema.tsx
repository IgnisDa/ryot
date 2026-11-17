import { catalogMessage } from "../../shared/messages.generated";
import { musicGroupRecipes } from "../../shared/music-group-recipes";
import { defineGroupMediaSchema } from "../media/group-schema";
import { musicSchema } from "../music/schema";
import { mediaSchemaAspects } from "../schema-aspects";

export const musicGroupSchema = defineGroupMediaSchema({
	member: musicSchema,
	kind: "music_group",
	recipes: musicGroupRecipes,
	aspect: mediaSchemaAspects["music-group"],
	members: { unit: "track", verb: "listen" },
	creditCopy: {
		people: catalogMessage("credits.artists"),
		companies: catalogMessage("credits.labels"),
		notice: catalogMessage("credits.notice.music-group"),
	},
});
