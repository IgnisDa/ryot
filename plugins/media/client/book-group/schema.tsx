import { bookGroupRecipes } from "../../shared/book-group-recipes";
import { bookSchema } from "../book/schema";
import { defineGroupMediaSchema } from "../media/group-schema";
import { mediaSchemaAspects } from "../schema-aspects";

export const bookGroupSchema = defineGroupMediaSchema({
	member: bookSchema,
	kind: "book_group",
	recipes: bookGroupRecipes,
	members: { unit: "book", verb: "read" },
	aspect: mediaSchemaAspects["book-group"],
});
