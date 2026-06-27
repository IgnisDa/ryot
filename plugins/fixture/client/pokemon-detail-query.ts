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

const nullableStrings = Schema.NullOr(Schema.Array(Schema.String));
const nullableNumber = Schema.NullOr(Schema.Number);
const pokemonImage = Schema.Struct({
	key: Schema.optional(Schema.String),
	url: Schema.optional(Schema.String),
	type: Schema.Literals(["local", "s3", "remote"]),
});

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
					types: selectedField(property("types"), nullableStrings),
					height: selectedField(property("height"), nullableNumber),
					weight: selectedField(property("weight"), nullableNumber),
					abilities: selectedField(property("abilities"), nullableStrings),
					id: selectedField(column(pokemon, "id"), Schema.String),
					pokedexNumber: selectedField(property("pokedexNumber"), nullableNumber),
					name: selectedField(column(pokemon, "name"), Schema.String),
					baseExperience: selectedField(property("baseExperience"), nullableNumber),
					sourceUrl: selectedField(property("sourceUrl"), Schema.NullOr(Schema.String)),
					images: selectedField(property("images"), Schema.NullOr(Schema.Array(pokemonImage))),
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
