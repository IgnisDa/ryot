import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./pokeapi";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "PokeAPI Pokémon Search",
	slug: "pokemon.pokeapi.search",
	searchOptionsSchema: {
		unknownKeys: "strict",
		fields: {
			includeAlternateForms: {
				type: "boolean",
				label: "Include alternate forms",
				description: "Include regional variants, mega evolutions, and other alternate forms",
			},
			typeNames: {
				label: "Types",
				type: "enum-array",
				description: "Only include Pokémon that have every selected type",
				choices: {
					kind: "static",
					values: [
						{ value: "bug", label: "Bug" },
						{ value: "dark", label: "Dark" },
						{ value: "dragon", label: "Dragon" },
						{ value: "electric", label: "Electric" },
						{ value: "fairy", label: "Fairy" },
						{ value: "fighting", label: "Fighting" },
						{ value: "fire", label: "Fire" },
						{ value: "flying", label: "Flying" },
						{ value: "ghost", label: "Ghost" },
						{ value: "grass", label: "Grass" },
						{ value: "ground", label: "Ground" },
						{ value: "ice", label: "Ice" },
						{ value: "normal", label: "Normal" },
						{ value: "poison", label: "Poison" },
						{ value: "psychic", label: "Psychic" },
						{ value: "rock", label: "Rock" },
						{ value: "steel", label: "Steel" },
						{ value: "water", label: "Water" },
					],
				},
			},
		},
	},
});

export default defineProvider({ manifest, operation: "search", run: search.run });
