import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "PokeAPI Pokémon Search",
	slug: "pokemon.pokeapi.search",
	searchOptionsSchema: {
		unknownKeys: "strict",
		fields: {
			includeAlternateForms: {
				type: "boolean",
				label: { key: "property.include-alternate-forms" },
				hint: { key: "property.include-alternate-forms-hint" },
				description: "Include regional variants, mega evolutions, and other alternate forms",
			},
			typeNames: {
				type: "enum-array",
				label: { key: "property.types" },
				hint: { key: "property.pokemon-types-hint" },
				description: "Only include Pokémon that have every selected type",
				choices: {
					kind: "static",
					values: [
						{ value: "bug", label: { key: "choice.bug" } },
						{ value: "dark", label: { key: "choice.dark" } },
						{ value: "dragon", label: { key: "choice.dragon" } },
						{ value: "electric", label: { key: "choice.electric" } },
						{ value: "fairy", label: { key: "choice.fairy" } },
						{ value: "fighting", label: { key: "choice.fighting" } },
						{ value: "fire", label: { key: "choice.fire" } },
						{ value: "flying", label: { key: "choice.flying" } },
						{ value: "ghost", label: { key: "choice.ghost" } },
						{ value: "grass", label: { key: "choice.grass" } },
						{ value: "ground", label: { key: "choice.ground" } },
						{ value: "ice", label: { key: "choice.ice" } },
						{ value: "normal", label: { key: "choice.normal" } },
						{ value: "poison", label: { key: "choice.poison" } },
						{ value: "psychic", label: { key: "choice.psychic" } },
						{ value: "rock", label: { key: "choice.rock" } },
						{ value: "steel", label: { key: "choice.steel" } },
						{ value: "water", label: { key: "choice.water" } },
					],
				},
			},
		},
	},
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
