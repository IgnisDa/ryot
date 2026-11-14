import { Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import type { PluginIdentityReference } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	jsonPath,
	parameters,
	type Recipe,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/plugin-client-sdk/ryotql";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import {
	PokemonArtworkListSchema,
	PokemonNumberSchema,
	PokemonStringsSchema,
} from "./pokemon-schema";

export const pokemonDetailRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "Entity Id",
				validation: { required: true },
				description: "Entity Id for this selection",
			},
		},
	});
	const requested = table("entity", "requested");
	const pokemon = table("entity", "pokemon");
	const property = (key: string) => jsonPath(column(pokemon, "properties"), key);
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ pokemon: row, requested: requestedRow }) =>
			Result.succeed({ pokemon: row ?? null, entitySchemaSlug: requestedRow?.schemaSlug ?? null }),
		queries: {
			requested: selectedOptionalRow(requested, {
				orderBy: [ascending(column(requested, "id"))],
				where: eq(column(requested, "id"), inputParameters.value("entityId")),
				selection: {
					schemaSlug: selectedField(column(requested, "entitySchemaSlug"), Schema.String),
				},
			}),
			pokemon: selectedOptionalRow(pokemon, {
				orderBy: [ascending(column(pokemon, "id"))],
				where: and(
					eq(column(pokemon, "id"), inputParameters.value("entityId")),
					entitySchemaPredicate(pokemon, "pokemon", input.reference),
				),
				selection: {
					id: selectedField(column(pokemon, "id"), Schema.String),
					name: selectedField(column(pokemon, "name"), Schema.String),
					types: selectedField(property("types"), PokemonStringsSchema),
					height: selectedField(property("height"), PokemonNumberSchema),
					weight: selectedField(property("weight"), PokemonNumberSchema),
					images: selectedField(property("images"), PokemonArtworkListSchema),
					abilities: selectedField(property("abilities"), PokemonStringsSchema),
					pokedexNumber: selectedField(property("pokedexNumber"), PokemonNumberSchema),
					sourceUrl: selectedField(property("sourceUrl"), Schema.NullOr(Schema.String)),
					baseExperience: selectedField(property("baseExperience"), PokemonNumberSchema),
				},
			}),
		},
	});
};
export type PokemonDetailData = Recipe.Success<ReturnType<typeof pokemonDetailRecipe>>;
export const pokemonDetailQuery = createRyotQuery<{ readonly entityId: string }, PokemonDetailData>(
	({ input, client }) =>
		client.data.query(
			pokemonDetailRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
			{ ...input },
		),
	{ entityWatch: ({ input }) => ({ visible: [], foreground: [input.entityId] }) },
);
