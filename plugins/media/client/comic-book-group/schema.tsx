import { comicBookGroupRecipes } from "../../shared/comic-book-group-recipes";
import { comicBookSchema } from "../comic-book/schema";
import { defineGroupMediaSchema } from "../media/group-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaSchemaAspects } from "../schema-aspects";

export const comicBookGroupSchema = defineGroupMediaSchema({
	member: comicBookSchema,
	recipes: comicBookGroupRecipes,
	heroHeight: () => MEDIA_ART_HEIGHT,
	aspect: mediaSchemaAspects["comic-book-group"],
	members: { verb: "read", tab: "Issues", noun: "issue" },
	nouns: { plural: "series", singular: "series", title: "Comic book series" },
});
