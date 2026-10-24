import { audiobookGroupRecipes } from "../../shared/audiobook-group-recipes";
import { audiobookSchema } from "../audiobook/schema";
import { defineGroupMediaSchema } from "../media/group-schema";
import { mediaSchemaAspects } from "../schema-aspects";

export const audiobookGroupSchema = defineGroupMediaSchema({
	member: audiobookSchema,
	recipes: audiobookGroupRecipes,
	aspect: mediaSchemaAspects["audiobook-group"],
	members: { verb: "listened", tab: "Audiobooks", noun: "audiobook" },
	nouns: { plural: "series", singular: "series", title: "Audiobook series" },
});
