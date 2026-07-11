import { Result, Schema } from "@ryot-app/client-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	inArray,
	jsonPath,
	literal,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/client-sdk/ryotql";

import {
	PokemonArtworkListSchema,
	PokemonNumberSchema,
	PokemonStringsSchema,
} from "./pokemon-schema";

export const pokemonPresentationRecipe = defineRecipe((entityIds: readonly string[]) => {
	const pokemon = table("entity", "pokemonPresentation");
	const property = (key: string) => jsonPath(column(pokemon, "properties"), key);
	return {
		queries: {
			pokemon: selectedRows(pokemon, {
				limit: 100,
				orderBy: [ascending(column(pokemon, "id"))],
				where: and(
					eq(column(pokemon, "entitySchemaSlug"), literal("pokemon")),
					inArray(
						column(pokemon, "id"),
						entityIds.map((entityId) => literal(entityId)),
					),
				),
				selection: {
					types: selectedField(property("types"), PokemonStringsSchema),
					height: selectedField(property("height"), PokemonNumberSchema),
					weight: selectedField(property("weight"), PokemonNumberSchema),
					id: selectedField(column(pokemon, "id"), Schema.String),
					artwork: selectedField(property("images"), PokemonArtworkListSchema),
					abilities: selectedField(property("abilities"), PokemonStringsSchema),
					name: selectedField(column(pokemon, "name"), Schema.String),
				},
			}),
		},
		map: ({ pokemon: rows }) => Result.succeed(rows.items),
	};
});

export type PokemonPresentationData = Recipe.Success<typeof pokemonPresentationRecipe>[number];
