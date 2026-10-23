import { mediaCreatorRecipes } from "../../../shared/creator-recipes";
import { creditCharacterSelection } from "../../../shared/media-recipes";

export const creatorFixtureRecipes = mediaCreatorRecipes({
	slug: "creator",
	alias: "creator",
	summaryFields: () => ({}),
	creditFields: creditCharacterSelection,
});

export const creatorPlainFixtureRecipes = mediaCreatorRecipes({
	slug: "plain",
	alias: "plain",
	summaryFields: () => ({}),
});
