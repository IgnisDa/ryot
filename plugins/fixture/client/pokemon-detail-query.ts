import { Result, Schema } from "@ryot-app/client-sdk/effect";
import { createRyotQuery } from "@ryot-app/client-sdk/react";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	jsonPath,
	literal,
	selectedField,
	selectedOptionalRow,
	table,
	type Recipe,
} from "@ryot-app/client-sdk/ryotql";

import {
	PokemonArtworkListSchema,
	PokemonNumberSchema,
	PokemonStringsSchema,
} from "./pokemon-schema";

export const pokemonDetailRecipe = defineRecipe((input: { readonly entityId: string }) => {
	const requested = table("entity", "requested");
	const pokemon = table("entity", "pokemon");
	const property = (key: string) => jsonPath(column(pokemon, "properties"), key);
	return {
		queries: {
			requested: selectedOptionalRow(requested, {
				orderBy: [ascending(column(requested, "id"))],
				where: eq(column(requested, "id"), literal(input.entityId)),
				selection: {
					schemaSlug: selectedField(column(requested, "entitySchemaSlug"), Schema.String),
				},
			}),
			pokemon: selectedOptionalRow(pokemon, {
				orderBy: [ascending(column(pokemon, "id"))],
				where: and(
					eq(column(pokemon, "id"), literal(input.entityId)),
					eq(column(pokemon, "entitySchemaSlug"), literal("pokemon")),
				),
				selection: {
					types: selectedField(property("types"), PokemonStringsSchema),
					height: selectedField(property("height"), PokemonNumberSchema),
					weight: selectedField(property("weight"), PokemonNumberSchema),
					images: selectedField(property("images"), PokemonArtworkListSchema),
					id: selectedField(column(pokemon, "id"), Schema.String),
					abilities: selectedField(property("abilities"), PokemonStringsSchema),
					name: selectedField(column(pokemon, "name"), Schema.String),
					pokedexNumber: selectedField(property("pokedexNumber"), PokemonNumberSchema),
					baseExperience: selectedField(property("baseExperience"), PokemonNumberSchema),
					sourceUrl: selectedField(property("sourceUrl"), Schema.NullOr(Schema.String)),
				},
			}),
		},
		map: ({ pokemon: row, requested: requestedRow }) =>
			Result.succeed({ pokemon: row ?? null, entitySchemaSlug: requestedRow?.schemaSlug ?? null }),
	};
});

export type PokemonDetailData = Recipe.Success<typeof pokemonDetailRecipe>;

export const pokemonDetailQuery = createRyotQuery<{ readonly entityId: string }, PokemonDetailData>(
	({ client, input, signal }) => client.data.query(pokemonDetailRecipe(input), { signal }),
	{ entityInterest: ({ input }) => ({ foreground: [input.entityId], visible: [] }) },
);
