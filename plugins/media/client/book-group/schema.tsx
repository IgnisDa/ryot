import { bookGroupRecipes } from "../../shared/book-group-recipes";
import { bookSchema } from "../book/schema";
import { defineGroupMediaSchema } from "../media/group-schema";
import { mediaSchemaAspects } from "../schema-aspects";

export const bookGroupSchema = defineGroupMediaSchema({
	member: bookSchema,
	recipes: bookGroupRecipes,
	aspect: mediaSchemaAspects["book-group"],
	members: { tab: "Books", noun: "book", verb: "read" },
	nouns: { plural: "series", singular: "series", title: "Book series" },
});
