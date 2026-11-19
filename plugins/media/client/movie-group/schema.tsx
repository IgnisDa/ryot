import { movieGroupRecipes } from "../../shared/movie-group-recipes";
import { defineGroupMediaSchema } from "../media/group-schema";
import { movieSchema } from "../movie/schema";
import { mediaSchemaAspects } from "../schema-aspects";

export const movieGroupSchema = defineGroupMediaSchema({
	member: movieSchema,
	kind: "movie_group",
	recipes: movieGroupRecipes,
	aspect: mediaSchemaAspects["movie-group"],
	members: { unit: "movie", verb: "watch" },
});
