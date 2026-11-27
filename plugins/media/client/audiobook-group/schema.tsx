import { audiobookGroupRecipes } from "../../shared/audiobook-group-recipes";
import { audiobookSchema } from "../audiobook/schema";
import { defineGroupMediaSchema } from "../media/group-schema";
import { mediaSchemaAspects } from "../schema-aspects";

export const audiobookGroupSchema = defineGroupMediaSchema({
	member: audiobookSchema,
	kind: "audiobook_group",
	recipes: audiobookGroupRecipes,
	aspect: mediaSchemaAspects["audiobook-group"],
	members: { verb: "listen", unit: "audiobook" },
});
