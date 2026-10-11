import { comicBookGroupRecipes } from "../../shared/comic-book-group-recipes";
import { comicBookSchema } from "../comic-book/schema";
import { defineGroupMediaSchema } from "../media/group-schema";
import { mediaSchemaAspects } from "../schema-aspects";

export const comicBookGroupSchema = defineGroupMediaSchema({
	member: comicBookSchema,
	recipes: comicBookGroupRecipes,
	aspect: mediaSchemaAspects["comic-book-group"],
	members: { verb: "read", tab: "Issues", noun: "issue" },
	nouns: { plural: "series", singular: "series", title: "Comic book series" },
});
