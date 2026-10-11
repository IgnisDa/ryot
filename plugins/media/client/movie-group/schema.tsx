import { movieGroupRecipes } from "../../shared/movie-group-recipes";
import { defineGroupMediaSchema } from "../media/group-schema";
import { movieSchema } from "../movie/schema";
import { mediaSchemaAspects } from "../schema-aspects";

export const movieGroupSchema = defineGroupMediaSchema({
	member: movieSchema,
	recipes: movieGroupRecipes,
	aspect: mediaSchemaAspects["movie-group"],
	members: { tab: "Movies", noun: "movie", verb: "watched" },
	nouns: { title: "Collection", plural: "collections", singular: "collection" },
});
