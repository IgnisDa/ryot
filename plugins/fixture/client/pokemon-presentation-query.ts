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

export const pokemonPresentationRecipe = defineRecipe((entityIds: readonly string[]) => {
	const pokemon = table("entity", "pokemonPresentation");
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
					id: selectedField(column(pokemon, "id"), Schema.String),
					name: selectedField(column(pokemon, "name"), Schema.String),
					types: selectedField(
						jsonPath(column(pokemon, "properties"), "types"),
						Schema.NullOr(Schema.Array(Schema.String)),
					),
				},
			}),
		},
		map: ({ pokemon: rows }) => Result.succeed(rows.items),
	};
});

export type PokemonPresentationData = Recipe.Success<typeof pokemonPresentationRecipe>[number];
