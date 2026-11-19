import { catalogMessage } from "../../shared/messages.generated";
import { videoGameGroupRecipes } from "../../shared/video-game-group-recipes";
import { defineGroupMediaSchema } from "../media/group-schema";
import { mediaSchemaAspects } from "../schema-aspects";
import { videoGameSchema } from "../video-game/schema";

export const videoGameGroupSchema = defineGroupMediaSchema({
	member: videoGameSchema,
	kind: "video_game_group",
	recipes: videoGameGroupRecipes,
	members: { unit: "game", verb: "play" },
	aspect: mediaSchemaAspects["video-game-group"],
	creditCopy: {
		people: catalogMessage("credits.people"),
		notice: catalogMessage("credits.notice"),
		companies: catalogMessage("credits.companies"),
	},
});
