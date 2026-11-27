import { comicBookGroupRecipes } from "../../shared/comic-book-group-recipes";
import { comicBookSchema } from "../comic-book/schema";
import { defineGroupMediaSchema } from "../media/group-schema";
import { mediaSchemaAspects } from "../schema-aspects";

export const comicBookGroupSchema = defineGroupMediaSchema({
	member: comicBookSchema,
	kind: "comic_book_group",
	recipes: comicBookGroupRecipes,
	members: { verb: "read", unit: "issue" },
	aspect: mediaSchemaAspects["comic-book-group"],
});
